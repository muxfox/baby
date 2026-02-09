import express from 'express';
import { Readable } from 'stream'; // Required to stream video in Node.js

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// --- Constants & Config ---
const MIRROR_HOSTS = [
    "h5.aoneroom.com", "movieboxapp.in", "moviebox.pk",
    "moviebox.ph", "moviebox.id", "v.moviebox.ph", "netnaija.video"
];

const SELECTED_HOST = "h5.aoneroom.com";
const HOST_URL = `https://${SELECTED_HOST}`;

const DEFAULT_HEADERS = {
    'X-Client-Info': '{"timezone":"Africa/Nairobi"}',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept': 'application/json',
    'User-Agent': 'okhttp/4.12.0',
    'Referer': HOST_URL,
    'Host': SELECTED_HOST,
    'Connection': 'keep-alive',
    'X-Forwarded-For': '1.1.1.1',
    'CF-Connecting-IP': '1.1.1.1',
    'X-Real-IP': '1.1.1.1'
};

const SubjectType = {
    ALL: 0,
    MOVIES: 1,
    TV_SERIES: 2,
    MUSIC: 6
};

let cookieCache = null;
let cookieCacheTime = 0;
const COOKIE_CACHE_DURATION = 3600000; // 1 hour

// --- Helper Functions ---

function processApiResponse(data) {
    if (data && data.data) {
        return data.data;
    }
    return data;
}

function sanitizeFilename(filename) {
    return filename
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_{2,}/g, '_')
        .trim();
}

async function getCookies() {
    const now = Date.now();
    if (cookieCache && (now - cookieCacheTime) < COOKIE_CACHE_DURATION) {
        return cookieCache;
    }

    try {
        const response = await fetch(`${HOST_URL}/wefeed-h5-bff/app/get-latest-app-pkgs?app_name=moviebox`, {
            headers: DEFAULT_HEADERS
        });

        // Node.js fetch uses 'set-cookie' header handling slightly differently than Workers
        const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : response.headers.get('set-cookie');
        
        let setCookieHeaders = [];
        if (Array.isArray(setCookie)) {
            setCookieHeaders = setCookie;
        } else if (setCookie) {
            setCookieHeaders = [setCookie];
        }

        if (setCookieHeaders.length > 0) {
            const cookies = setCookieHeaders.map(cookie => {
                const parts = cookie.split(';');
                return parts[0].trim();
            }).join('; ');
            
            cookieCache = cookies;
            cookieCacheTime = now;
        }
        
        return cookieCache;
    } catch (error) {
        console.error('Failed to get cookies:', error.message);
        return null;
    }
}

async function makeApiRequest(url, options = {}) {
    const cookies = await getCookies();
    
    const headers = { ...DEFAULT_HEADERS, ...options.headers };
    if (cookies) {
        headers['Cookie'] = cookies;
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    return response;
}

// --- Route Handlers ---

// 1. Homepage Data
app.get('/api/homepage', async (req, res) => {
    try {
        const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/home`);
        const data = await response.json();
        const content = processApiResponse(data);
        res.json({ status: 'success', data: content });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 2. Trending
app.get('/api/trending', async (req, res) => {
    try {
        const page = req.query.page || 0;
        const perPage = req.query.perPage || 18;
        
        const params = new URLSearchParams({
            page: page,
            perPage: perPage,
            uid: '5591179548772780352'
        });
        
        const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/trending?${params}`);
        const data = await response.json();
        const content = processApiResponse(data);
        res.json({ status: 'success', data: content });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 3. Search
app.get('/api/search/:query', async (req, res) => {
    try {
        const query = req.params.query;
        const page = req.query.page || 1;
        const perPage = req.query.perPage || 24;
        const subjectType = parseInt(req.query.type) || SubjectType.ALL;
        
        const payload = {
            keyword: query,
            page,
            perPage,
            subjectType
        };
        
        const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        let content = processApiResponse(data);
        
        if (subjectType !== SubjectType.ALL && content.items) {
            content.items = content.items.filter(item => item.subjectType === subjectType);
        }
        
        // Fix thumbnails
        if (content.items) {
            content.items.forEach(item => {
                if (item.cover && item.cover.url) item.thumbnail = item.cover.url;
                if (item.stills && item.stills.url && !item.thumbnail) item.thumbnail = item.stills.url;
            });
        }
        
        res.json({ status: 'success', data: content });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 4. Info
app.get('/api/info/:movieId', async (req, res) => {
    try {
        const params = new URLSearchParams({ subjectId: req.params.movieId });
        const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/detail?${params}`);
        const data = await response.json();
        const content = processApiResponse(data);
        
        if (content.subject) {
            if (content.subject.cover && content.subject.cover.url) content.subject.thumbnail = content.subject.cover.url;
            if (content.subject.stills && content.subject.stills.url && !content.subject.thumbnail) content.subject.thumbnail = content.subject.stills.url;
        }
        
        res.json({ status: 'success', data: content });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 5. Sources
app.get('/api/sources/:movieId', async (req, res) => {
    try {
        const movieId = req.params.movieId;
        const season = req.query.season || 0;
        const episode = req.query.episode || 0;
        
        // Get Movie Detail Path first
        const infoParams = new URLSearchParams({ subjectId: movieId });
        const infoResponse = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/detail?${infoParams}`);
        const infoData = await infoResponse.json();
        const movieInfo = processApiResponse(infoData);
        
        const detailPath = movieInfo?.subject?.detailPath;
        if (!detailPath) {
            return res.status(500).json({ status: 'error', message: 'Could not get movie detail path' });
        }
        
        const refererUrl = `https://fmoviesunblocked.net/spa/videoPlayPage/movies/${detailPath}?id=${movieId}&type=/movie/detail`;
        const params = new URLSearchParams({ subjectId: movieId, se: season, ep: episode });
        
        const response = await makeApiRequest(`${HOST_URL}/wefeed-h5-bff/web/subject/download?${params}`, {
            headers: { 'Referer': refererUrl, 'Origin': 'https://fmoviesunblocked.net' }
        });
        
        const data = await response.json();
        const content = processApiResponse(data);
        
        if (content && content.downloads) {
            const title = movieInfo?.subject?.title || 'video';
            const isEpisode = season > 0 && episode > 0;
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const host = req.headers.host;
            const baseUrl = `${protocol}://${host}`;
            
            content.processedSources = content.downloads.map(file => {
                const downloadParams = new URLSearchParams({
                    url: file.url,
                    title: title,
                    quality: file.resolution || 'Unknown'
                });
                
                if (isEpisode) {
                    downloadParams.append('season', season);
                    downloadParams.append('episode', episode);
                }
                
                return {
                    id: file.id,
                    quality: file.resolution || 'Unknown',
                    directUrl: file.url,
                    downloadUrl: `${baseUrl}/api/download?${downloadParams.toString()}`,
                    streamUrl: `${baseUrl}/api/stream?url=${encodeURIComponent(file.url)}`,
                    size: file.size,
                    format: 'mp4'
                };
            });
        }
        
        res.json({ status: 'success', data: content });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 6. Stream Proxy
app.get('/api/stream', async (req, res) => {
    try {
        const streamUrl = req.query.url;
        if (!streamUrl || (!streamUrl.startsWith('https://bcdnxw.hakunaymatata.com/') && !streamUrl.startsWith('https://valiw.hakunaymatata.com/') && !streamUrl.startsWith('https://bcdnw.hakunaymatata.com/'))) {
            return res.status(400).json({ status: 'error', message: 'Invalid stream URL' });
        }

        const range = req.headers.range;
        
        // Head Request for size
        const headResponse = await fetch(streamUrl, {
            method: 'HEAD',
            headers: {
                'User-Agent': 'okhttp/4.12.0',
                'Referer': 'https://fmoviesunblocked.net/',
                'Origin': 'https://fmoviesunblocked.net'
            }
        });
        
        const fileSize = parseInt(headResponse.headers.get('content-length'));
        const contentType = headResponse.headers.get('content-type') || 'video/mp4';
        
        if (!fileSize) return res.status(500).json({ message: 'Could not determine file size' });

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            let start = parseInt(parts[0], 10);
            let end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            
            if (isNaN(start) && !isNaN(end)) { start = fileSize - end; end = fileSize - 1; }
            if (start >= fileSize || start > end) return res.status(416).header('Content-Range', `bytes */${fileSize}`).send();
            
            const chunkSize = (end - start) + 1;
            const headers = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType,
            };

            res.writeHead(206, headers);

            const videoResponse = await fetch(streamUrl, {
                headers: {
                    'User-Agent': 'okhttp/4.12.0',
                    'Referer': 'https://fmoviesunblocked.net/',
                    'Origin': 'https://fmoviesunblocked.net',
                    'Range': `bytes=${start}-${end}`
                }
            });

            // Convert Web Stream to Node Stream and Pipe
            Readable.fromWeb(videoResponse.body).pipe(res);

        } else {
            const headers = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes',
            };
            res.writeHead(200, headers);
            
            const videoResponse = await fetch(streamUrl, {
                headers: {
                    'User-Agent': 'okhttp/4.12.0',
                    'Referer': 'https://fmoviesunblocked.net/',
                    'Origin': 'https://fmoviesunblocked.net'
                }
            });
            Readable.fromWeb(videoResponse.body).pipe(res);
        }
    } catch (error) {
        console.error(error);
        if (!res.headersSent) res.status(500).json({ message: 'Stream error' });
    }
});

// 7. Download Proxy
app.get('/api/download', async (req, res) => {
    try {
        const downloadUrl = req.query.url;
        const title = req.query.title || 'video';
        // Parse simple string params if they come in as strings
        const season = req.query.season;
        const episode = req.query.episode;
        const quality = req.query.quality || '';

        if (!downloadUrl) return res.status(400).json({ message: 'No URL provided' });

        // Define the headers needed to bypass restrictions
        const proxyHeaders = {
            'User-Agent': 'okhttp/4.12.0',
            'Referer': 'https://fmoviesunblocked.net/',
            'Origin': 'https://fmoviesunblocked.net'
        };

        // Filename construction
        // Note: Make sure you have the sanitizeFilename function defined elsewhere
        let filename = sanitizeFilename(title); 
        if (season && episode) {
            filename += `_S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
        }
        if (quality) {
            filename += `_${quality}`;
        }
        if (!filename.endsWith('.mp4')) {
            filename += '.mp4';
        }

        // 1. HEAD request to get file size and type using specific headers
        const headResponse = await fetch(downloadUrl, { 
            method: 'HEAD', 
            headers: proxyHeaders 
        });

        const fileSize = headResponse.headers.get('content-length');
        const contentType = headResponse.headers.get('content-type') || 'video/mp4';

        // 2. Set response headers for download
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', contentType);
        if (fileSize) res.setHeader('Content-Length', fileSize);

        // 3. GET request to pipe the data using specific headers
        const response = await fetch(downloadUrl, { 
            headers: proxyHeaders 
        });

        // Pipe the web stream to the response
        Readable.fromWeb(response.body).pipe(res);

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) res.status(500).json({ message: error.message });
    }
});

// Root Route (The HTML Homepage)
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MovieBox API - Node.js</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; line-height: 1.6; color: #333; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; padding: 20px; }
        .container { max-width: 800px; margin: 0 auto; background: white; border-radius: 15px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); overflow: hidden; }
        .header { background: linear-gradient(135deg, #ff6b6b, #ee5a24); color: white; padding: 30px; text-align: center; }
        .header h1 { font-size: 2.5em; margin-bottom: 10px; font-weight: 700; }
        .endpoint { background: #f8f9fa; border-radius: 10px; padding: 20px; margin: 20px; border-left: 5px solid #667eea; }
        .endpoint h3 { color: #667eea; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎬 MovieBox API</h1>
            <p>Running on Node.js v${process.version}</p>
        </div>
        <div class="endpoint">
            <h3>📥 Available Endpoints</h3>
            <ul>
                <li>/api/homepage</li>
                <li>/api/trending</li>
                <li>/api/search/:query</li>
                <li>/api/info/:movieId</li>
                <li>/api/sources/:movieId</li>
                <li>/api/stream?url=...</li>
            </ul>
        </div>
    </div>
</body>
</html>`);
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`MovieBox API Server running on http://localhost:${PORT}`);
});
