from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
import requests
import urllib.parse
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI()

# Enable CORS so frontend can easily hit these endpoints
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DownloadRequest(BaseModel):
    url: str
    format: str

@app.post("/api/download")
def get_download_info(req: DownloadRequest):
    url = req.url
    format_type = req.format
    
    if not url:
        return JSONResponse(status_code=400, content={"success": False, "error": "URL is required"})
        
    try:
        # Determine extraction options
        base_opts = {
            'quiet': True,
            'no_warnings': True,
            'nocheckcertificate': True,
            'skip_download': True,
            'extractor_args': {'youtube': ['client=android,ios,web']},
        }
        
        if format_type == 'mp3':
            ydl_opts = {
                **base_opts,
                'format': 'bestaudio/best',
            }
        else:
            ydl_opts = {
                **base_opts,
                'format': 'best[ext=mp4]/best',
            }
            
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            if not info:
                return JSONResponse(status_code=500, content={"success": False, "error": "Failed to extract video info"})
                
            # Handle playlist
            if 'entries' in info or info.get('_type') == 'playlist':
                entries = []
                raw_entries = info.get('entries', [])
                for entry in raw_entries:
                    if entry:
                        entries.append({
                            'title': entry.get('title') or "Untitled Video",
                            'url': entry.get('webpage_url') or entry.get('url'),
                            'duration': entry.get('duration') or 0,
                        })
                return {
                    'success': True,
                    'isPlaylist': True,
                    'title': info.get('title') or "Playlist",
                    'entries': entries
                }
            
            # Single video download
            title = info.get('title', 'download')
            # Sanitize title to avoid filename issues on user devices
            clean_title = "".join(c for c in title if c.isalnum() or c in "._- ").strip()
            if not clean_title:
                clean_title = "download"
                
            stream_url = info.get('url')
            if not stream_url and 'formats' in info:
                formats = [f for f in info.get('formats', []) if f.get('url')]
                if formats:
                    # Sort formats to find a suitable one
                    # Find format containing both if possible or best available
                    stream_url = formats[-1].get('url')
                    
            if not stream_url:
                return JSONResponse(status_code=400, content={"success": False, "error": "No direct streaming URL found"})
                
            ext = info.get('ext', 'mp4')
            if format_type == 'mp3':
                ext = 'mp3'
                
            filename = f"{clean_title}.{ext}"
            
            # Fetch size from info
            size = info.get('filesize') or info.get('filesize_approx') or 0
            
            # If size is not present, perform a quick HEAD request
            if size == 0:
                try:
                    head_res = requests.head(stream_url, headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                    }, timeout=5)
                    if head_res.status_code in (200, 206):
                        size = int(head_res.headers.get('Content-Length', 0))
                except Exception:
                    pass
            
            # Default needProxy to True to bypass CORS and resolve YouTube/TikTok IP blocks
            need_proxy = True
            
            http_headers = info.get('http_headers', {})
            
            return {
                'success': True,
                'isPlaylist': False,
                'url': stream_url,
                'filename': filename,
                'size': size,
                'ext': ext,
                'needProxy': need_proxy,
                'httpHeaders': http_headers
            }
            
    except Exception as e:
        return JSONResponse(status_code=400, content={"success": False, "error": str(e)})

import json

@app.get("/api/proxy")
def proxy_stream(
    url: str = Query(..., description="The direct media URL to proxy"),
    start: int = Query(None, description="Start byte"),
    end: int = Query(None, description="End byte"),
    headers_json: str = Query(None, description="JSON string of custom headers to pass")
):
    try:
        req_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        
        if headers_json:
            try:
                import urllib.parse
                decoded_json = urllib.parse.unquote(headers_json)
                custom_headers = json.loads(decoded_json)
                req_headers.update(custom_headers)
            except Exception:
                pass
                
        if start is not None and end is not None:
            req_headers["Range"] = f"bytes={start}-{end}"
            
        # Make requests with a streaming connection
        resp = requests.get(url, headers=req_headers, stream=True, timeout=12, verify=False)
        
        if resp.status_code not in (200, 206):
            raise HTTPException(status_code=resp.status_code, detail=f"Failed to fetch media chunk from source: {resp.status_code}")
            
        def generate():
            # Read chunk-by-chunk and stream back immediately
            for chunk in resp.iter_content(chunk_size=16384):
                yield chunk
                
        response_headers = {
            "Content-Range": resp.headers.get("Content-Range", ""),
            "Content-Length": resp.headers.get("Content-Length", ""),
            "Content-Type": resp.headers.get("Content-Type", "application/octet-stream"),
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Content-Type, Accept-Ranges",
            "Accept-Ranges": "bytes"
        }
        
        return StreamingResponse(
            generate(),
            status_code=resp.status_code,
            headers={k: v for k, v in response_headers.items() if v}
        )
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
