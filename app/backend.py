import os
import sys
import time
import json
import re
import gc
import psutil
from typing import Dict, Any, List
from bottle import Bottle, request, response, static_file, abort
from ytmusicapi import YTMusic
import yt_dlp

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
TEMPLATES_DIR = os.path.join(BASE_DIR, 'templates')

# Portable data directory inside project for cross-platform hosting (cPanel / Linux / Windows)
DATA_DIR = os.path.join(BASE_DIR, 'data')
os.makedirs(DATA_DIR, exist_ok=True)
USER_DATA_FILE = os.path.join(DATA_DIR, 'user_data.json')

def load_user_data() -> Dict[str, Any]:
    if os.path.exists(USER_DATA_FILE):
        try:
            with open(USER_DATA_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error reading user data: {e}")
    return {"favorites": [], "savedPlaylists": [], "volume": 0.8, "gamerMode": False}

def save_user_data(data: Dict[str, Any]) -> bool:
    try:
        with open(USER_DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Error saving user data: {e}")
        return False

app = Bottle()
yt = YTMusic()

# -------------------------------------------------------------------------
# YOUTUBE COOKIE & STREAM AUTHENTICATION (Bypasses Datacenter Bot-Walls)
# -------------------------------------------------------------------------
COOKIES_PATH = os.path.join(DATA_DIR, 'cookies.txt')

def resolve_cookies_file() -> str:
    """Finds cookies from YOUTUBE_COOKIES environment variable or local file."""
    env_cookies = os.environ.get('YOUTUBE_COOKIES', '').strip()
    if env_cookies:
        try:
            if not env_cookies.startswith('#') and len(env_cookies) > 50 and '\n' not in env_cookies:
                import base64
                try:
                    decoded = base64.b64decode(env_cookies).decode('utf-8', errors='ignore')
                    if '# Netscape' in decoded or 'youtube.com' in decoded:
                        env_cookies = decoded
                except Exception:
                    pass

            with open(COOKIES_PATH, 'w', encoding='utf-8') as f:
                f.write(env_cookies)
            return COOKIES_PATH
        except Exception as e:
            print(f"[AUTH] Error writing YOUTUBE_COOKIES to file: {e}")

    root_cookies = os.path.join(os.path.dirname(BASE_DIR), 'cookies.txt')
    if os.path.exists(root_cookies):
        return root_cookies
    if os.path.exists(COOKIES_PATH):
        return COOKIES_PATH
    return None

STREAM_CACHE: Dict[str, Dict[str, Any]] = {}

def extract_stream_url(video_id: str) -> Dict[str, Any]:
    """
    Extracts direct audio stream URL avoiding datacenter IP bot detection.
    Never uses 'web' client by default because it triggers YouTube bot wall on cloud IPs.
    Tries resilient mobile/embedded clients and uses cookies if configured.
    """
    now = time.time()
    if video_id in STREAM_CACHE:
        cached = STREAM_CACHE[video_id]
        if now < cached['expires']:
            return {'url': cached['url'], 'duration': cached['duration']}

    cookiefile = resolve_cookies_file()
    
    # Resilient client candidates for datacenter/cloud IPs
    client_candidates = [
        ['android'],
        ['tv_embedded'],
        ['android_creator']
    ]

    last_error = None
    for clients in client_candidates:
        ydl_opts = {
            'format': '140/bestaudio[ext=m4a]/bestaudio/best',
            'quiet': True,
            'skip_download': True,
            'noplaylist': True,
            'check_formats': False,
            'extractor_args': {
                'youtube': {
                    'player_client': clients
                }
            }
        }
        if cookiefile and os.path.exists(cookiefile):
            ydl_opts['cookiefile'] = cookiefile

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
                stream_url = info.get('url')
                duration = info.get('duration', 0)
                if stream_url:
                    STREAM_CACHE[video_id] = {
                        'url': stream_url,
                        'duration': duration,
                        'expires': now + 7200
                    }
                    return {'url': stream_url, 'duration': duration}
        except Exception as err:
            last_error = err
            continue

    err_str = str(last_error) if last_error else 'Unknown error'
    print(f"[STREAM] Failed extracting stream for {video_id}: {err_str}")
    if 'Sign in to confirm' in err_str or '429' in err_str:
        raise Exception(
            "YouTube requiere autenticación en este servidor en la nube. "
            "Para solucionarlo de forma permanente, añade la variable YOUTUBE_COOKIES en Render."
        )
    raise last_error or Exception("No se pudo obtener el audio de la canción")


def get_optimized_thumb(thumbnails: List[Dict[str, Any]], size: int = 226) -> str:
    """Optimizes thumbnail resolution to save memory while looking sharp."""
    if not thumbnails:
        return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80'
    thumb = thumbnails[-1].get('url', '')
    if '=w' in thumb and '-h' in thumb:
        thumb = re.sub(r'=w\d+-h\d+', f'=w{size}-h{size}', thumb)
    elif '=s' in thumb:
        thumb = re.sub(r'=s\d+', f'=s{size}', thumb)
    return thumb

def extract_playlist_id(url_or_id: str) -> str:
    """Extracts YouTube playlist ID from raw URL or plain ID."""
    if not url_or_id:
        return ''
    url_or_id = url_or_id.strip()
    match = re.search(r'list=([a-zA-Z0-9_-]+)', url_or_id)
    if match:
        return match.group(1)
    return url_or_id

def sanitize_artists(artists_data: Any) -> str:
    if isinstance(artists_data, list):
        names = [a.get('name', '') for a in artists_data if isinstance(a, dict) and a.get('name')]
        return ', '.join(names) if names else 'Artista Desconocido'
    if isinstance(artists_data, str):
        return artists_data
    return 'Artista Desconocido'

# --- API ROUTES ---

@app.hook('after_request')
def enable_cors():
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Origin, Accept, Content-Type, X-Requested-With, Range, Authorization'

@app.route('/<:re:.*>', method='OPTIONS')
def enable_cors_generic_options():
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Origin, Accept, Content-Type, X-Requested-With, Range, Authorization'
    response.headers['Access-Control-Max-Age'] = '86400'
    return {}

@app.route('/health')
@app.route('/api/health')
def health_check():
    response.content_type = 'application/json'
    return {
        'status': 'ok',
        'service': 'Lumina Music API',
        'version': '1.0.0',
        'timestamp': int(time.time())
    }

@app.route('/')
def index():
    return static_file('index.html', root=TEMPLATES_DIR)

@app.route('/manifest.json')
def serve_manifest():
    response.content_type = 'application/manifest+json; charset=utf-8'
    return static_file('manifest.json', root=STATIC_DIR)

@app.route('/sw.js')
def serve_service_worker():
    response.set_header('Cache-Control', 'no-cache, no-store, must-revalidate')
    response.set_header('Service-Worker-Allowed', '/')
    response.content_type = 'application/javascript; charset=utf-8'
    return static_file('sw.js', root=STATIC_DIR)

@app.route('/static/<filepath:path>')
def server_static(filepath):
    return static_file(filepath, root=STATIC_DIR)

@app.route('/api/user/data', method=['GET', 'POST', 'OPTIONS'])
def user_data_endpoint():
    if request.method == 'OPTIONS':
        return {}
    if request.method == 'POST':
        try:
            data = request.json
            if not isinstance(data, dict):
                body_bytes = request.body.read()
                data = json.loads(body_bytes.decode('utf-8'))
            save_user_data(data)
            return {'status': 'ok'}
        except Exception as e:
            print(f"Error saving user data: {e}")
            abort(400, str(e))
    return load_user_data()


@app.route('/api/system/stats')
def system_stats():
    try:
        # Periodic light garbage collection to keep Python heap tiny
        gc.collect(1)
        proc = psutil.Process(os.getpid())
        rss_mb = round(proc.memory_info().rss / (1024 * 1024), 1)
        cpu = proc.cpu_percent(interval=None)
        return {'ram_mb': rss_mb, 'cpu_percent': cpu}
    except Exception as e:
        return {'ram_mb': 40.0, 'cpu_percent': 0.0}

@app.route('/api/explore')
def explore():
    """Returns curated starter playlists & trending tracks for home screen."""
    sections = []
    
    categories = [
        {"id": "pop", "name": "Top Pop & Éxitos", "query": "Top Hits 2026 Pop", "icon": "sparkles"},
        {"id": "rock", "name": "Rock Clásico & Moderno", "query": "Greatest Rock Hits", "icon": "flame"},
        {"id": "latino", "name": "Éxitos Latinos", "query": "Top Canciones Latino Reggaeton Pop", "icon": "disc"},
        {"id": "lofi", "name": "Lo-Fi & Chillout", "query": "Lo-Fi Beats to Relax Study", "icon": "coffee"},
        {"id": "electronic", "name": "Electrónica & Synthwave", "query": "Electronic Synthwave Chillstep", "icon": "zap"}
    ]
    
    try:
        trending_results = yt.search("Top Hits Canciones", filter="songs")[:12]
        trending_songs = []
        for item in trending_results:
            vid = item.get('videoId')
            if not vid:
                continue
            trending_songs.append({
                'id': vid,
                'title': item.get('title', 'Canción'),
                'artist': sanitize_artists(item.get('artists', [])),
                'album': item.get('album', {}).get('name', '') if isinstance(item.get('album'), dict) else '',
                'duration': item.get('duration', '3:30'),
                'thumbnail': get_optimized_thumb(item.get('thumbnails', []))
            })
        if trending_songs:
            sections.append({
                'title': '🔥 Tendencias del Momento',
                'description': 'Las canciones más reproducidas en YouTube Music hoy',
                'items': trending_songs
            })
    except Exception as e:
        print(f"Error fetching trending: {e}")
        
    return {'categories': categories, 'sections': sections}

@app.route('/api/search')
def search():
    query = request.query.get('q', '').strip()
    filter_type = request.query.get('filter', 'songs')
    if not query:
        return {'results': []}
        
    try:
        # Check if the query is actually a playlist URL or ID
        if 'list=' in query or query.startswith('PL') or query.startswith('RD') or query.startswith('VL'):
            pl_id = extract_playlist_id(query)
            if pl_id:
                return {'is_playlist': True, 'playlist_id': pl_id}

        raw_results = yt.search(query, filter=filter_type if filter_type != 'all' else None)[:24]
        items = []
        for item in raw_results:
            vid = item.get('videoId')
            if not vid:
                continue
            items.append({
                'id': vid,
                'title': item.get('title', 'Sin título'),
                'artist': sanitize_artists(item.get('artists', [])),
                'album': item.get('album', {}).get('name', '') if isinstance(item.get('album'), dict) else '',
                'duration': item.get('duration', '--:--'),
                'thumbnail': get_optimized_thumb(item.get('thumbnails', []))
            })
        gc.collect(1)
        return {'results': items}
    except Exception as e:
        print(f"Search error: {e}")
        return {'results': [], 'error': str(e)}

@app.route('/api/playlist')
def get_playlist_data():
    """Fetches details and tracks for a YouTube Music playlist."""
    url_or_id = request.query.get('id', '') or request.query.get('url', '')
    limit_param = request.query.get('limit', '200')
    
    pl_id = extract_playlist_id(url_or_id)
    if not pl_id:
        abort(400, "Missing playlist id or url")
        
    limit_val = None if limit_param == 'all' else int(limit_param)
    
    try:
        pl_data = yt.get_playlist(pl_id, limit=limit_val)
        raw_tracks = pl_data.get('tracks', [])
        
        tracks = []
        for item in raw_tracks:
            vid = item.get('videoId')
            if not vid:
                continue
            tracks.append({
                'id': vid,
                'title': item.get('title', 'Canción'),
                'artist': sanitize_artists(item.get('artists', [])),
                'album': item.get('album', {}).get('name', '') if isinstance(item.get('album'), dict) else '',
                'duration': item.get('duration', '--:--'),
                'thumbnail': get_optimized_thumb(item.get('thumbnails', []))
            })
            
        thumb = ''
        if pl_data.get('thumbnails'):
            thumb = get_optimized_thumb(pl_data['thumbnails'], size=400)
        elif tracks:
            thumb = tracks[0]['thumbnail']
            
        res = {
            'id': pl_id,
            'title': pl_data.get('title', 'Mi Playlist'),
            'description': pl_data.get('description', ''),
            'author': pl_data.get('author', {}).get('name', '') if isinstance(pl_data.get('author'), dict) else '',
            'trackCount': pl_data.get('trackCount', len(tracks)),
            'thumbnail': thumb,
            'tracks': tracks
        }
        gc.collect()
        return res
    except Exception as e:
        print(f"Error fetching playlist {pl_id}: {e}")
        abort(500, f"Error al cargar playlist: {str(e)}")

@app.route('/api/stream')
def stream():
    """Extracts fast direct audio stream URL with caching and bot-bypass fallback."""
    video_id = request.query.get('id', '').strip()
    if not video_id:
        abort(400, "Missing video id")

    try:
        data = extract_stream_url(video_id)
        return data
    except Exception as e:
        msg = str(e)
        status_code = 429 if ('Sign in' in msg or '429' in msg) else 500
        abort(status_code, msg)

@app.route('/api/queue')
def get_related_queue():
    """Gets related recommendations / radio for continuous playback."""
    video_id = request.query.get('id', '').strip()
    if not video_id:
        return {'tracks': []}
        
    try:
        watch = yt.get_watch_playlist(videoId=video_id)
        raw_tracks = watch.get('tracks', [])[1:16] # Skip current song, keep queue lean
        tracks = []
        for item in raw_tracks:
            vid = item.get('videoId')
            if not vid or vid == video_id:
                continue
            tracks.append({
                'id': vid,
                'title': item.get('title', 'Canción'),
                'artist': sanitize_artists(item.get('artists', [])),
                'album': item.get('album', {}).get('name', '') if isinstance(item.get('album'), dict) else '',
                'duration': item.get('length', '--:--'),
                'thumbnail': get_optimized_thumb(item.get('thumbnail', []))
            })
        gc.collect(1)
        return {'tracks': tracks}
    except Exception as e:
        print(f"Error getting queue: {e}")
        return {'tracks': []}

@app.route('/api/lyrics')
def get_lyrics():
    """Gets song lyrics if available from YouTube Music."""
    video_id = request.query.get('id', '').strip()
    if not video_id:
        return {'lyrics': None}
        
    try:
        watch = yt.get_watch_playlist(videoId=video_id)
        lyrics_id = watch.get('lyrics')
        if not lyrics_id:
            return {'lyrics': None, 'message': 'No hay letras disponibles para esta canción.'}
            
        lyrics_data = yt.get_lyrics(lyrics_id)
        return {
            'lyrics': lyrics_data.get('lyrics', ''),
            'source': lyrics_data.get('source', '')
        }
    except Exception as e:
        print(f"Error fetching lyrics: {e}")
        return {'lyrics': None, 'error': str(e)}

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
