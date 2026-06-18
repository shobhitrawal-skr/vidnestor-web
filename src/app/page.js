"use client";

import { useState, useEffect } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState('mp4'); // mp4 (video) or mp3 (audio)
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(null); // { type: 'success'|'error'|'info', text: '' }
  const [downloads, setDownloads] = useState([]);
  const [shareableFile, setShareableFile] = useState(null);

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

  // Load downloads history from localStorage and register PWA service worker
  useEffect(() => {
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

      // Auto-trigger browser download save dialog
      const tempLink = document.createElement('a');
      tempLink.href = localUrl;
      tempLink.setAttribute('download', filename);
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);

      // Cleanup Object URL to release browser memory
      setTimeout(() => URL.revokeObjectURL(localUrl), 10000);

      // Prepare native share payload (mainly for mobile Safari/Chrome to Save to Photos)
      try {
        const file = new File([fileBlob], filename, { type: mimeType });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          setShareableFile(file);
        }
      } catch (shareErr) {
        console.warn('Failed to construct shareable file:', shareErr);
      }

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
      setStatus({
        type: 'error',
        text: `Error: ${err.message}. Please verify the URL and try again.`
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
            Download social media videos instantly.
          </h1>
          <p className="hero-lede">
            VidNestor provides high-speed direct downloads for YouTube, Instagram, TikTok, Twitter/X, and more. Completely free, no registration required, zero ads.
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
              <label className="label">Enter Video or Playlist URL</label>
              <div className="input-wrapper">
                <span className="input-icon">🔗</span>
                <input
                  type="url"
                  required
                  placeholder="Paste YouTube, Instagram, TikTok, or Twitter link..."
                  className="url-input"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  disabled={loading || isDownloading}
                />
              </div>
            </div>

            {/* Format Selection */}
            <div className="form-group" style={{ marginTop: '1.5rem' }}>
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
              disabled={loading || isDownloading || !url}
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
                {status.type === 'success' && shareableFile && (
                  <button
                    type="button"
                    onClick={handleShare}
                    className="share-btn"
                  >
                    📱 Save to Photos / Share
                  </button>
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

      {/* Supported Platforms Wall (T2 Logo Wall Hairline) */}
      <section className="section-container compatibility-wall">
        <h2 className="compatibility-label">Supported Social Networks</h2>
        <div className="logo-grid">
          <div className="logo-item">
            <span className="logo-icon">📺</span>
            <span>YouTube</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">📸</span>
            <span>Instagram</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">🎵</span>
            <span>TikTok</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">🐦</span>
            <span>Twitter / X</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">📌</span>
            <span>Pinterest</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">📘</span>
            <span>Facebook</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">🤖</span>
            <span>Reddit</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">🎥</span>
            <span>Vimeo</span>
          </div>
          <div className="logo-item">
            <span className="logo-icon">✨</span>
            <span>and Many More</span>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="section-container features-section" id="features">
        <h2 className="features-section-title">Designed for creators and developers</h2>
        <div className="features-grid">
          <div className="feature-card">
            <span className="feature-icon">🎬</span>
            <h3 className="feature-title">Download Video</h3>
            <p className="feature-description">
              Save high-definition videos in standard MP4 formats with direct, high-speed streaming integration.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🎵</span>
            <h3 className="feature-title">Download Audio</h3>
            <p className="feature-description">
              Extract audio tracks from any supported platform and download them as high-quality, high-bitrate MP3 files.
            </p>
          </div>
          <div className="feature-card">
            <span className="feature-icon">🔒</span>
            <h3 className="feature-title">Zero Logging & Tracking</h3>
            <p className="feature-description">
              We never save your URLs or downloaded files. All downloads occur locally, keeping your media consumption completely secure and private.
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
                Currently, VidNestor supports YouTube (including channels and playlist expansion), Instagram (Reels & posts), TikTok, Twitter/X, Pinterest, Facebook, Reddit, Vimeo, and many other platforms.
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
    </div>
  );
}
