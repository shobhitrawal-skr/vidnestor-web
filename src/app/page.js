"use client";

import { useState, useEffect } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('mp4'); // mp4 (video) or mp3 (audio)
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error'|'info', text: '' }
  const [downloads, setDownloads] = useState([]);
  const [shareableFile, setShareableFile] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [downloadFilename, setDownloadFilename] = useState(null);

  // PWA Install Prompt States
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const [showIosPrompt, setShowIosPrompt] = useState(false);
  const [pwaDismissed, setPwaDismissed] = useState(false);

  // Playlist State
  const [playlist, setPlaylist] = useState(null); // { title: '', entries: [...] }

  // Chunked Download Progress States
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState('');
  const [downloadEta, setDownloadEta] = useState('');
  const [downloadSizeInfo, setDownloadSizeInfo] = useState('');

  // Fallback direct download link
  const [fallbackLink, setFallbackLink] = useState(null);
  const [fallbackFilename, setFallbackFilename] = useState(null);

  // Platform Detection and YouTube block state
  const [detectedPlatform, setDetectedPlatform] = useState(null);
  const [isYoutubeBlocked, setIsYoutubeBlocked] = useState(false);

  // Mobile detection state
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  // Platform detection hook
  useEffect(() => {
    if (!url) {
      setDetectedPlatform(null);
      setIsYoutubeBlocked(false);
      return;
    }

    const lowerUrl = url.toLowerCase();
    
    // Check YouTube first
    if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be') || lowerUrl.includes('youtube-nocookie.com')) {
      setDetectedPlatform('youtube');
      setIsYoutubeBlocked(true);
      return;
    }
    
    setIsYoutubeBlocked(false);

    if (lowerUrl.includes('instagram.com')) {
      setDetectedPlatform('instagram');
    } else if (lowerUrl.includes('tiktok.com')) {
      setDetectedPlatform('tiktok');
    } else if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch') || lowerUrl.includes('fb.com')) {
      setDetectedPlatform('facebook');
    } else if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) {
      setDetectedPlatform('x');
    } else if (lowerUrl.includes('pinterest.com') || lowerUrl.includes('pin.it')) {
      setDetectedPlatform('pinterest');
    } else if (lowerUrl.includes('reddit.com') || lowerUrl.includes('redd.it')) {
      setDetectedPlatform('reddit');
    } else if (lowerUrl.includes('vimeo.com')) {
      setDetectedPlatform('vimeo');
    } else {
      setDetectedPlatform('unknown');
    }
  }, [url]);

  // Load downloads history from localStorage and register PWA service worker
  useEffect(() => {
    const mobileCheck = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                        (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
                        (typeof window !== 'undefined' && 'ontouchstart' in window);
    setIsMobileDevice(mobileCheck);

    try {
      const saved = localStorage.getItem('vidnestor_web_downloads');
      if (saved) {
        setDownloads(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load downloads history:', e);
    }

    // PWA Service Worker Registration
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
          .then((reg) => console.log('Service Worker registered successfully with scope:', reg.scope))
          .catch((err) => console.error('Service Worker registration failed:', err));
      });
    }

    // PWA Install Prompts initialization
    const dismissed = sessionStorage.getItem('vidnestor_pwa_dismissed');
    if (dismissed) {
      setPwaDismissed(true);
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

      if (isIos && !isStandalone) {
        setShowIosPrompt(true);
      }
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!sessionStorage.getItem('vidnestor_pwa_dismissed')) {
        setShowInstallBtn(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Save downloads history to localStorage
  const saveDownloads = (newDownloads) => {
    setDownloads(newDownloads);
    try {
      localStorage.setItem('vidnestor_web_downloads', JSON.stringify(newDownloads));
    } catch (e) {
      console.error('Failed to save downloads history:', e);
    }
  };

  // Human-readable ETA formatting: "X hours Y minutes Z seconds"
  const formatDuration = (sec) => {
    if (sec === Infinity || isNaN(sec)) return 'Calculating...';
    const s = Math.round(sec);
    if (s <= 0) return '0 seconds';

    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;

    let parts = [];
    if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
    if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} second${seconds > 1 ? 's' : ''}`);

    return parts.join(' ');
  };

  // Video Duration Formatter (seconds to MM:SS or H:MM:SS)
  const formatVideoDuration = (sec) => {
    if (!sec) return 'Unknown';
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Range-based chunked download engine
  const downloadFileInChunks = async (streamUrl, filename, initialSize, sourceUrl, selectedFormat, httpHeaders = {}) => {
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadSpeed('0.00 MB/s');
    setDownloadEta('Calculating...');
    setDownloadSizeInfo('0 MB / 0 MB');
    setFallbackLink(null);
    setFallbackFilename(null);
    setShareableFile(null);
    setDownloadUrl(null);
    setDownloadFilename(null);

    const CHUNK_SIZE = 1.5 * 1024 * 1024; // 1.5MB chunks to prevent Vercel serverless timeouts
    let downloadedBytes = 0;
    let totalSize = initialSize;
    let chunks = [];
    const startTime = Date.now();

    const headersJson = encodeURIComponent(JSON.stringify(httpHeaders));

    try {
      while (totalSize === 0 || downloadedBytes < totalSize) {
        const start = downloadedBytes;
        const end = totalSize > 0
          ? Math.min(downloadedBytes + CHUNK_SIZE - 1, totalSize - 1)
          : downloadedBytes + CHUNK_SIZE - 1;

        const proxyUrl = `/api/proxy?url=${encodeURIComponent(streamUrl)}&start=${start}&end=${end}&headers_json=${headersJson}`;
        const res = await fetch(proxyUrl);

        if (!res.ok) {
          // Range Not Satisfiable when size was unknown means we reached end of file
          if (res.status === 416 && totalSize === 0) {
            break;
          }
          throw new Error(`Engine returned error code ${res.status}`);
        }

        // Dynamic detection of total file size from Content-Range response header
        const contentRange = res.headers.get('Content-Range');
        if (contentRange) {
          const match = contentRange.match(/\/(\d+)$/);
          if (match) {
            totalSize = parseInt(match[1], 10);
          }
        }

        const buffer = await res.arrayBuffer();
        if (buffer.byteLength === 0) {
          break;
        }

        chunks.push(new Uint8Array(buffer));
        downloadedBytes += buffer.byteLength;

        // Speed & ETA calculations
        const elapsedSeconds = (Date.now() - startTime) / 1000;
        const speedBytes = downloadedBytes / (elapsedSeconds || 0.1);
        const remainingBytes = totalSize > 0 ? (totalSize - downloadedBytes) : 0;
        const etaSeconds = speedBytes > 0 ? (remainingBytes / speedBytes) : 0;

        // Progress percentage
        const progressPercent = totalSize > 0 ? Math.round((downloadedBytes / totalSize) * 100) : 0;
        setDownloadProgress(progressPercent);

        // Speed in MB/s
        const speedMB = speedBytes / (1024 * 1024);
        setDownloadSpeed(`${speedMB.toFixed(2)} MB/s`);

        // Formatting progress size numbers
        const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
        const totalMB = totalSize > 0 ? (totalSize / (1024 * 1024)).toFixed(1) : '?';
        setDownloadSizeInfo(`${downloadedMB} MB / ${totalMB} MB`);

        if (totalSize > 0) {
          setDownloadEta(`${formatDuration(etaSeconds)} remaining`);
        } else {
          setDownloadEta('Streaming file bytes...');
        }

        // Stop if the response was a standard full download 200 OK instead of partial 206
        if (res.status === 200) {
          totalSize = downloadedBytes;
          break;
        }

        // Fallback check if server did not set range headers but stopped sending bytes
        if (res.status === 206 && !contentRange && buffer.byteLength < CHUNK_SIZE) {
          totalSize = downloadedBytes;
          break;
        }
      }

      // Stitch all byte chunks together
      const mimeType = selectedFormat === 'mp3' ? 'audio/mpeg' : 'video/mp4';
      const fileBlob = new Blob(chunks, { type: mimeType });
      const localUrl = URL.createObjectURL(fileBlob);

      // Create a Blob with application/octet-stream for direct, clean download in iOS Safari/PWA (prevents popups/previews)
      const octetBlob = new Blob(chunks, { type: 'application/octet-stream' });
      const cleanDownloadUrl = URL.createObjectURL(octetBlob);

      setDownloadUrl(cleanDownloadUrl);
      setDownloadFilename(filename);

      // Detect standalone PWA mode, mobile/touch devices, and Safari
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                       (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ||
                       (typeof window !== 'undefined' && 'ontouchstart' in window);
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      
      let fileObj = null;
      try {
        fileObj = new File([fileBlob], filename, { type: mimeType });
      } catch (fErr) {
        console.warn('Failed to create file object:', fErr);
      }

      const canShare = fileObj && navigator.canShare && navigator.canShare({ files: [fileObj] });

      // If the browser is mobile, Safari, or running as an installed PWA (standalone), we DO NOT
      // trigger the automatic click. This prevents Safari/Chrome on iOS/Android from opening
      // a blank page or video player popup showing the filename that the user has to manually close.
      // Instead, we show clean manual share/save buttons in the completion UI.
      if (isMobile || isStandalone || isSafari) {
        if (canShare) {
          setShareableFile(fileObj);
        }
      } else {
        // Auto-trigger browser download save dialog for desktop browsers
        const tempLink = document.createElement('a');
        tempLink.href = localUrl;
        tempLink.setAttribute('download', filename);
        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);
        
        if (canShare) {
          setShareableFile(fileObj);
        }
      }

      // Cleanup Object URLs to release browser memory after 30 seconds to allow manual clicks
      setTimeout(() => {
        URL.revokeObjectURL(localUrl);
        URL.revokeObjectURL(cleanDownloadUrl);
      }, 30000);

      // Add to session downloads history
      const cleanSourceUrl = sourceUrl.replace(/https?:\/\/(www\.)?/, '').slice(0, 30) + '...';
      const newItem = {
        id: Date.now(),
        title: filename,
        url: streamUrl,
        format: selectedFormat,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        sourceUrl: sourceUrl
      };
      saveDownloads([newItem, ...downloads]);

      setStatus({ type: 'success', text: 'Download completed successfully!' });

      // Clear URL input field


    } catch (err) {
      console.error('[Browser Download Error]:', err.message);
      setStatus({
        type: 'error',
        text: `Download process was interrupted: ${err.message}. Use the manual link below.`
      });
      setFallbackLink(streamUrl);
      setFallbackFilename(filename);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownload = async (e) => {
    e.preventDefault();
    if (!url) return;

    // Platform validation checks
    if (isYoutubeBlocked) {
      setStatus({
        type: 'error',
        text: 'YouTube downloads are currently not supported.'
      });
      return;
    }

    if (detectedPlatform === 'unknown') {
      setStatus({
        type: 'error',
        text: 'This platform is not currently supported.'
      });
      return;
    }

    setLoading(true);
    setPlaylist(null);
    setFallbackLink(null);
    setFallbackFilename(null);
    setStatus({ type: 'info', text: 'Connecting to VidNestor engine to download link...' });

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, format }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to extract download link');
      }

      if (data.isPlaylist) {
        setPlaylist(data);
        setStatus({
          type: 'success',
          text: `Downloaded playlist "${data.title}" successfully! Select videos below to download.`
        });
      } else {
        // Single video download
        setStatus({ type: 'info', text: 'Download prepared! Initiating high-speed download...' });
        await downloadFileInChunks(data.url, data.filename, data.size, url, format, data.httpHeaders);
      }
    } catch (err) {
      console.error('[Download Error]:', err.message);
      
      let userFriendlyMsg = 'Failed to extract download link. Please check the URL and try again.';
      const lowerErr = err.message.toLowerCase();
      
      if (lowerErr.includes('not supported') || lowerErr.includes('unsupported')) {
        userFriendlyMsg = 'This platform is not currently supported.';
      } else if (lowerErr.includes('rate-limited') || lowerErr.includes('blocked') || lowerErr.includes('bot') || lowerErr.includes('confirm you\'re not a bot')) {
        userFriendlyMsg = 'The download service is temporarily busy. Please try again in a few moments.';
      } else if (lowerErr.includes('private') || lowerErr.includes('unavailable') || lowerErr.includes('invalid') || lowerErr.includes('does not exist')) {
        userFriendlyMsg = 'The post or video is private, unavailable, or the URL is invalid.';
      }
      
      setStatus({
        type: 'error',
        text: userFriendlyMsg
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePlaylistEntryDownload = async (entryUrl, entryTitle, forcedFormat) => {
    setLoading(true);
    setFallbackLink(null);
    setFallbackFilename(null);
    setStatus({ type: 'info', text: `Downloading playlist item: "${entryTitle}"...` });

    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: entryUrl, format: forcedFormat }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus({ type: 'info', text: 'Item prepared! Initiating chunked download...' });
        await downloadFileInChunks(data.url, data.filename, data.size, entryUrl, forcedFormat, data.httpHeaders);
      } else {
        throw new Error(data.error || 'Failed to extract stream for this playlist item.');
      }
    } catch (err) {
      setStatus({ type: 'error', text: `Playlist item download failed: ${err.message}` });
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    saveDownloads([]);
  };

  const handleShare = async () => {
    if (!shareableFile) return;
    try {
      await navigator.share({
        files: [shareableFile],
        title: 'Save Video',
        text: 'Save downloaded media to your device'
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Failed to share file:', err);
      }
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`PWA install prompt outcome: ${outcome}`);
    setDeferredPrompt(null);
    setShowInstallBtn(false);
  };

  const handleDismissPwa = () => {
    sessionStorage.setItem('vidnestor_pwa_dismissed', 'true');
    setPwaDismissed(true);
  };

  return (
    <div className="page-wrapper">
      {/* Sticky Navigation Bar (N1b/N10 Archetype) */}
      <header className="header-nav">
        <div className="nav-container">
          <a href="/" className="nav-brand" onClick={(e) => { e.preventDefault(); window.scrollTo(0, 0); window.location.href = '/'; }}>
            <img src="/logo.png" alt="VidNestor Logo" className="nav-logo-img" />
            <span className="nav-logo-text">VidNestor</span>
          </a>
          <nav className="nav-links">
            <a href="#downloader" className="nav-link">download</a>
            <a href="#features" className="nav-link">features</a>
            <a href="#history" className="nav-link">history</a>
            <a href="#faq" className="nav-link">faq</a>
          </nav>
        </div>
      </header>

      {/* Hero Section (H2 Split Diptych) */}
      <section className="section-container hero-split" id="downloader">
        <div className="hero-left">
          <div className="hero-badge">
            <span>⚡</span>
            <span>VidNestor Engine v2.0</span>
          </div>
          <h1 className="hero-title">
            Download videos from social platforms
          </h1>
          <p className="hero-lede">
            Fast, free downloads from Instagram, TikTok, Facebook, X, Pinterest, Reddit and more. No signup required.
          </p>
          <div className="hero-bullets">
            <div className="hero-bullet">
              <span className="hero-bullet-dot"></span>
              <span>No signups</span>
            </div>
            <div className="hero-bullet">
              <span className="hero-bullet-dot"></span>
              <span>No ad popups</span>
            </div>
            <div className="hero-bullet">
              <span className="hero-bullet-dot"></span>
              <span>100% private</span>
            </div>
          </div>
        </div>

        {/* Right side: Downloader Card */}
        <main className="downloader-card">
          <form onSubmit={handleDownload}>
            {/* URL Input */}
            <div className="form-group">
              <label className="label">Enter Video URL</label>
              <div className="input-wrapper">
                <span className="input-icon">🔗</span>
                <input
                  type="url"
                  required
                  placeholder="Paste Instagram, TikTok, Facebook, X, or Pinterest link..."
                  className="url-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading || isDownloading}
                />
              </div>
              
              {/* Platform indicators directly below input */}
              <div className="supported-platforms-indicator">
                Instagram • TikTok • Facebook • X • Pinterest • Reddit • Vimeo
              </div>

              {/* Dynamic Platform Detection Feedback */}
              {detectedPlatform && detectedPlatform !== 'unknown' && detectedPlatform !== 'youtube' && (
                <div className="platform-detected-badge">
                  ✨ {detectedPlatform.charAt(0).toUpperCase() + detectedPlatform.slice(1)} URL detected
                </div>
              )}

              {/* YouTube Specific Block Warning */}
              {isYoutubeBlocked && (
                <div className="youtube-warning">
                  ⚠️ YouTube downloads are currently not supported.
                </div>
              )}
            </div>

            {/* Format Selection */}
            <div className="form-group" style={{ marginTop: '0.75rem' }}>
              <label className="label">Download Format</label>
              <div className="format-selector">
                <div className="format-option">
                  <input
                    type="radio"
                    id="format-video"
                    name="format"
                    value="mp4"
                    checked={format === 'mp4'}
                    onChange={() => setFormat('mp4')}
                    disabled={loading || isDownloading}
                  />
                  <label htmlFor="format-video" className="format-label">
                    🎬 Video (MP4)
                  </label>
                </div>
                <div className="format-option">
                  <input
                    type="radio"
                    id="format-audio"
                    name="format"
                    value="mp3"
                    checked={format === 'mp3'}
                    onChange={() => setFormat('mp3')}
                    disabled={loading || isDownloading}
                  />
                  <label htmlFor="format-audio" className="format-label">
                    🎵 Audio (MP3)
                  </label>
                </div>
              </div>
            </div>

            <button 
              type="submit" 
              className={`download-btn ${loading ? 'loading' : ''} ${isDownloading ? 'downloading' : ''}`} 
              disabled={loading || isDownloading || !url || isYoutubeBlocked}
            >
              {loading ? (
                <>
                  <span className="spinner"></span>
                  <span>downloading...</span>
                </>
              ) : isDownloading ? (
                <>
                  <span className="spinner"></span>
                  <span>downloading...</span>
                </>
              ) : (
                <>
                  <span>📥</span>
                  <span>Download</span>
                </>
              )}
            </button>
          </form>

          {/* Real-time Download Progress Card */}
          {isDownloading && (
            <div className="progress-container">
              <div className="progress-header">
                <span>Downloading File...</span>
                <span>{downloadProgress}%</span>
              </div>
              <div className="progress-bar-bg">
                <div className="progress-bar-fill" style={{ width: `${downloadProgress}%` }}></div>
              </div>
              <div className="progress-meta">
                <div className="progress-meta-item">
                  <span>⚡</span>
                  <span>{downloadSpeed}</span>
                </div>
                <div className="progress-meta-item">
                  <span>📦</span>
                  <span>{downloadSizeInfo}</span>
                </div>
                <div className="progress-meta-item" style={{ gridColumn: 'span 2', marginTop: '0.25rem', color: 'var(--color-muted)' }}>
                  <span>🕒</span>
                  <span>{downloadEta}</span>
                </div>
              </div>
            </div>
          )}

          {/* Fallback Direct Link UI Banner */}
          {fallbackLink && (
            <div className="fallback-download-container">
              <strong>⚠️ Chunked download interrupted.</strong>
              <span>Your browser block size limits or connection drops prevented assembly. Download the raw stream directly:</span>
              <a
                href={fallbackLink}
                download={fallbackFilename || "download"}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-fallback"
              >
                📥 Download Raw Media Stream
              </a>
            </div>
          )}

          {/* Status Message */}
          {status && (
            <div className={`status-msg ${status.type}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', width: '100%' }}>
              <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>
                {status.type === 'error' ? '❌' : status.type === 'success' ? '✅' : '🔄'}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexGrow: 1, alignItems: 'flex-start' }}>
                <span style={{ lineHeight: '1.4' }}>{status.text}</span>
                {isMobileDevice && status.type === 'success' && (shareableFile || downloadUrl) && (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', width: '100%', marginTop: '4px' }}>
                    {shareableFile && (
                      <button
                        type="button"
                        onClick={handleShare}
                        className="share-btn"
                        style={{ flex: '1 1 auto' }}
                      >
                        📱 Save to Photos / Share
                      </button>
                    )}
                    {downloadUrl && (
                      <a
                        href={downloadUrl}
                        download={downloadFilename || "video.mp4"}
                        className="share-btn"
                        style={{
                          flex: '1 1 auto',
                          textDecoration: 'none',
                          textAlign: 'center',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'var(--color-accent-2)'
                        }}
                      >
                        📥 Save to Files
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Transfer Engine (E5 hand-built SVG) */}
          <div className="transfer-engine-wrapper">
            <svg className="transfer-engine-svg" viewBox="0 0 240 48" width="100%">
              {/* Line 1 */}
              <line
                x1="40"
                y1="24"
                x2="110"
                y2="24"
                stroke={loading || isDownloading ? "var(--color-accent)" : "var(--color-rule)"}
                strokeWidth="1.5"
                className={`transfer-line ${(loading || isDownloading) ? 'active' : ''}`}
              />
              {/* Line 2 */}
              <line
                x1="130"
                y1="24"
                x2="200"
                y2="24"
                stroke={isDownloading ? "var(--color-accent)" : "var(--color-rule)"}
                strokeWidth="1.5"
                className={`transfer-line ${isDownloading ? 'active' : ''}`}
              />

              {/* Node 1: Download */}
              <circle
                cx="30"
                cy="24"
                r="6"
                fill={loading || isDownloading || status?.type === 'success' ? "var(--color-accent)" : "var(--color-paper-3)"}
                stroke={loading || isDownloading || status?.type === 'success' ? "var(--color-accent)" : "var(--color-rule-2)"}
                strokeWidth="2"
                className="transfer-node"
              />
              
              {/* Node 2: Stream */}
              <circle
                cx="120"
                cy="24"
                r="6"
                fill={isDownloading || status?.type === 'success' ? "var(--color-accent)" : "var(--color-paper-3)"}
                stroke={isDownloading || status?.type === 'success' ? "var(--color-accent)" : "var(--color-rule-2)"}
                strokeWidth="2"
                className="transfer-node"
              />
              
              {/* Node 3: Save */}
              <circle
                cx="210"
                cy="24"
                r="6"
                fill={status?.type === 'success' ? "var(--color-accent-2)" : "var(--color-paper-3)"}
                stroke={status?.type === 'success' ? "var(--color-accent-2)" : "var(--color-rule-2)"}
                strokeWidth="2"
                className="transfer-node"
              />
            </svg>
            
            <div className="transfer-engine-status">
              {loading ? "downloading target stream..." : isDownloading ? `streaming chunks (${downloadProgress}%)` : ""}
            </div>
          </div>
        </main>
      </section>

      {/* Trust Badges Section */}
      <section className="section-container trust-section">
        <div className="trust-badges">
          <div className="trust-badge">
            <span className="trust-badge-check">✓</span>
            <span className="trust-badge-text">No Login Required</span>
          </div>
          <div className="trust-badge">
            <span className="trust-badge-check">✓</span>
            <span className="trust-badge-text">No Ads</span>
          </div>
          <div className="trust-badge">
            <span className="trust-badge-check">✓</span>
            <span className="trust-badge-text">Private Downloads</span>
          </div>
          <div className="trust-badge">
            <span className="trust-badge-check">✓</span>
            <span className="trust-badge-text">Fast Processing</span>
          </div>
        </div>
      </section>

      {/* Supported Platforms Section */}
      <section className="section-container compatibility-wall" id="platforms">
        <h2 className="compatibility-label">Supported Social Networks</h2>
        <div className="logo-grid">
          <div className="logo-item instagram">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z" />
              </svg>
            </span>
            <span className="logo-text">Instagram</span>
          </div>
          <div className="logo-item tiktok">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.06-2.89-.52-4.06-1.39-.77-.57-1.39-1.34-1.81-2.23-.08 2.89-.02 5.79-.04 8.68-.06 2.37-.9 4.82-2.73 6.36-1.92 1.67-4.7 2.19-7.14 1.41-2.9-1.01-4.93-3.99-4.83-7.07.05-3.52 2.92-6.66 6.44-6.86.83-.06 1.67.08 2.47.37V9.01c-.96-.44-2.04-.54-3.08-.29-2.07.45-3.55 2.51-3.28 4.62.24 1.79 1.76 3.19 3.56 3.15 1.72-.05 3.07-1.45 3.13-3.17.03-4.32-.01-8.64-.01-12.96-.06-.11-.13-.24-.15-.37z" />
              </svg>
            </span>
            <span className="logo-text">TikTok</span>
          </div>
          <div className="logo-item twitter">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </span>
            <span className="logo-text">Twitter / X</span>
          </div>
          <div className="logo-item pinterest">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.204 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.162 0 7.397 2.967 7.397 6.93 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12 0-6.628-5.373-12-12-12z" />
              </svg>
            </span>
            <span className="logo-text">Pinterest</span>
          </div>
          <div className="logo-item facebook">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </span>
            <span className="logo-text">Facebook</span>
          </div>
          <div className="logo-item reddit">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M24 11.5c0-1.65-1.35-3-3-3-.96 0-1.86.48-2.42 1.24-1.64-1-3.85-1.64-6.29-1.72l1.3-4.14 4.23 1c.04 1.11.96 2 2.08 2 1.15 0 2.1-0.95 2.1-2.1s-0.95-2.1-2.1-2.1c-1.03 0-1.89.75-2.05 1.74l-4.75-1.12c-0.22-0.05-0.45.08-0.51.3l-1.56 5c-2.47.05-4.72.7-6.38 1.72-0.56-.76-1.46-1.24-2.42-1.24-1.65 0-3 1.35-3 3 0 1.05.54 1.97 1.37 2.51-.06.33-.09.66-.09 1 0 3.86 4.49 7 10 7s10-3.14 10-7c0-.34-.03-.67-.09-1 .83-.54 1.37-1.46 1.37-2.51zM5.5 13.5c0-1.1.9-2 2-2s2 .9 2 2-0.9 2-2 2-2-.9-2-2zM17 17.5c-1.83 1.83-5.17 1.83-7 0-0.2-.2-0.2-0.51 0-0.71.2-.2.51-.2.71 0 1.44 1.44 4.14 1.44 5.58 0 .2-.2.51-.2.71 0 .2.2.2.51 0 .71zM14.5 15.5c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-0.9 2-2 2z" />
              </svg>
            </span>
            <span className="logo-text">Reddit</span>
          </div>
          <div className="logo-item vimeo">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M22.396 7.111c-.088 1.962-1.466 4.646-4.135 8.054-2.767 3.551-5.109 5.326-7.026 5.326-1.196 0-2.203-1.102-3.023-3.307-.549-2.022-1.099-4.043-1.649-6.065-.609-2.24-1.267-3.36-1.977-3.36-.153 0-.687.324-1.603.974l-.959-1.222c.983-.86 1.956-1.728 2.922-2.601 1.36-1.196 2.378-1.833 3.056-1.91 1.583-.178 2.56.908 2.934 3.256.406 2.544.69 4.12.854 4.73.418 1.691.878 2.536 1.383 2.536.395 0 1.01-.648 1.844-1.94 1.031-1.625 1.59-2.66 1.678-3.111.176-.845-.109-1.267-.856-1.267-.35 0-.791.077-1.328.23 1.153-3.771 3.355-5.59 6.608-5.456 2.404.103 3.513 1.67 3.327 4.703z" />
              </svg>
            </span>
            <span className="logo-text">Vimeo</span>
          </div>
          <div className="logo-item more">
            <span className="logo-icon">
              <svg viewBox="0 0 24 24" className="brand-svg">
                <path d="M12 2l1.62 5.26L19 9l-5.38 1.38L12 16l-1.62-5.62L5 9l5.38-1.74L12 2zm7 12l.94 3.06L23 18l-3.06.94L19 22l-.94-3.06L15 18l3.06-.94L19 14zM6 13l.63 2.06L9 16l-2.31.63L6 19l-.63-2.37L3 16l2.37-.63L6 13z" />
              </svg>
            </span>
            <span className="logo-text">and Many More</span>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="section-container features-section" id="features">
        <h2 className="features-section-title">Designed for privacy and speed</h2>
        <div className="features-grid">
          <div className="feature-card">
            <span className="feature-icon">⚡</span>
            <h3 className="feature-title">Fast Downloads</h3>
            <p className="feature-description">
              High-speed media retrieval directly from the content delivery networks of your favorite social platforms.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">📱</span>
            <h3 className="feature-title">Multiple Platforms</h3>
            <p className="feature-description">
              Optimized extraction support for Instagram, TikTok, Facebook, X (Twitter), Pinterest, Reddit, and Vimeo.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🔒</span>
            <h3 className="feature-title">Private by Design</h3>
            <p className="feature-description">
              Zero logs, zero tracking. All queries and media stitching processes occur on-the-fly, keeping your media use private.
            </p>
          </div>
        </div>
      </section>

      {/* YouTube Playlist Results Container */}
      {playlist && (
        <section className="section-container">
          <div className="playlist-section">
            <div className="playlist-header">
              <span>📚</span>
              <span>Playlist: {playlist.title}</span>
            </div>
            <div className="playlist-list">
              {playlist.entries.length === 0 ? (
                <div className="empty-state">No videos found in this playlist.</div>
              ) : (
                playlist.entries.map((item, idx) => (
                  <div key={idx} className="playlist-item">
                    <div className="playlist-item-left">
                      <span className="playlist-item-index">{idx + 1}</span>
                      <div className="playlist-item-details">
                        <span className="playlist-item-title" title={item.title}>
                          {item.title}
                        </span>
                        <span className="playlist-item-duration">
                          ⏱️ {formatVideoDuration(item.duration)}
                        </span>
                      </div>
                    </div>
                    <div className="playlist-item-actions">
                      <button
                        onClick={() => handlePlaylistEntryDownload(item.url, item.title, 'mp4')}
                        disabled={loading || isDownloading}
                        className="btn-small btn-download-video"
                      >
                        🎬 Video
                      </button>
                      <button
                        onClick={() => handlePlaylistEntryDownload(item.url, item.title, 'mp3')}
                        disabled={loading || isDownloading}
                        className="btn-small btn-download-audio"
                      >
                        🎵 Audio
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* Download History Card */}
      <section className="section-container" id="history">
        <div className="history-section">
          <div className="history-header">
            <div className="history-header-title">
              <span>📁</span>
              <span>Session Downloads</span>
            </div>
            {downloads.length > 0 && (
              <button className="btn-clear" onClick={clearHistory}>
                Clear All
              </button>
            )}
          </div>

          <div className="history-list">
            {downloads.length === 0 ? (
              <div className="empty-state">
                No files downloaded in this session.
              </div>
            ) : (
              downloads.map((item) => (
                <div key={item.id} className="history-item">
                  <div className="history-item-left">
                    <span className="history-item-icon">{item.format === 'mp3' ? '🎵' : '🎬'}</span>
                    <div className="history-item-details">
                      <span className="history-item-title" title={item.title}>
                        {item.title}
                      </span>
                      <div className="history-item-meta">
                        <span>{item.format.toUpperCase()}</span>
                        <span>•</span>
                        <span>{item.timestamp}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Conversational FAQ Section (06 Accordion FAQ Layout) */}
      <section className="section-container faq-section" id="faq">
        <h2 className="features-section-title">Frequently Asked Questions</h2>
        <div className="faq-list">
          <details className="faq-item">
            <summary className="faq-summary">
              <span>Is VidNestor completely free?</span>
              <span className="faq-icon">＋</span>
            </summary>
            <div className="faq-answer">
              <p>
                Yes. There are no pricing tiers, download limits, signup requirements, or premium subscriptions. The app is fully funded as an open-source media downloader.
              </p>
            </div>
          </details>

          <details className="faq-item">
            <summary className="faq-summary">
              <span>Which social websites are supported for downloads?</span>
              <span className="faq-icon">＋</span>
            </summary>
            <div className="faq-answer">
              <p>
                Currently, VidNestor supports Instagram (Reels & posts), TikTok, Facebook, X (Twitter), Pinterest, Reddit, Vimeo, and many other platforms. Please note that YouTube downloads are not supported.
              </p>
            </div>
          </details>

          <details className="faq-item">
            <summary className="faq-summary">
              <span>How many videos can I download?</span>
              <span className="faq-icon">＋</span>
            </summary>
            <div className="faq-answer">
              <p>
                There are no download limits. You can download as many media files as you need, whenever you want.
              </p>
            </div>
          </details>
        </div>
      </section>

      {/* Statement Footer Archetype (Ft5) */}
      <footer className="footer">
        <div className="footer-content">
          <p className="footer-statement">
            VidNestor downloads media directly to your device.
          </p>
          <div className="footer-links">
            <a href="#downloader">Download</a>
            <a href="#features">Features</a>
            <a href="#faq">FAQ</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="footer-meta">
            <span>© 2026 VidNestor</span>
            <span className="footer-dot">•</span>
            <span>All rights reserved</span>
            <span className="footer-dot">•</span>
            <span>Hosted on Vercel</span>
          </div>
        </div>
      </footer>

      {/* PWA iOS Install Prompt Guide */}
      {!pwaDismissed && showIosPrompt && (
        <div className="pwa-prompt">
          <div className="pwa-prompt-header">
            <span className="pwa-prompt-title">Install VidNestor</span>
            <button className="pwa-close-btn" onClick={handleDismissPwa}>✕</button>
          </div>
          <div className="pwa-prompt-body">
            To install this app on your iPhone: tap the <strong>Share</strong> button <span style={{ fontSize: '1.2rem', verticalAlign: 'middle', lineHeight: '1' }}>⎋</span> and select <strong>"Add to Home Screen"</strong> <span style={{ fontSize: '1.2rem', verticalAlign: 'middle', lineHeight: '1' }}>⊞</span>.
          </div>
        </div>
      )}

      {/* PWA Android/Desktop Programmatic Install Button */}
      {!pwaDismissed && showInstallBtn && (
        <div className="pwa-prompt">
          <div className="pwa-prompt-header">
            <span className="pwa-prompt-title">Install App</span>
            <button className="pwa-close-btn" onClick={handleDismissPwa}>✕</button>
          </div>
          <div className="pwa-prompt-body" style={{ marginBottom: '8px' }}>
            Install VidNestor on your device for a fast, app-like experience.
          </div>
          <button className="pwa-install-btn" onClick={handleInstallClick}>
            Install App
          </button>
        </div>
      )}
    </div>
  );
}
