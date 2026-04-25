import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// =========================================================
// ESM FIX (__dirname replacement)
// =========================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================================================
// ROOT PATH
// =========================================================
const ROOT = path.resolve(__dirname, '..');

const DATA_DIR = path.join(ROOT, 'data');
const CLIENT_DIR = path.join(ROOT, 'ui-client');

// =========================================================
// MIME TYPES
// =========================================================
const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
};

// =========================================================
// RECURSIVE FILE WALK
// =========================================================
function walk(dir, base = '', extensions = null) {
    let results = [];

    const list = fs.readdirSync(dir);

    for (const file of list) {
        const filePath = path.join(dir, file);
        const relPath = path.join(base, file);

        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            results = results.concat(walk(filePath, relPath, extensions));
        } else {

            // If no filter → return everything
            if (!extensions || extensions.length === 0) {
                results.push(relPath.replace(/\\/g, '/'));
                continue;
            }

            const ext = path.extname(file).toLowerCase();

            if (extensions.includes(ext)) {
                results.push(relPath.replace(/\\/g, '/'));
            }
        }
    }

    return results;
}

// =========================================================
// SERVER
// =========================================================
const server = http.createServer((req, res) => {

    const parsedUrl = new URL(req.url, 'http://localhost');
    let pathname = parsedUrl.pathname;

    // =====================================================
    // API: FILE LIST
    // =====================================================
    if (pathname === '/api/files') {
        try {
            const files = walk(DATA_DIR, '', ['.mp3']);

            res.writeHead(200, {
                'Content-Type': 'application/json'
            });

            return res.end(JSON.stringify(files));
        } catch (err) {
            res.writeHead(500);
            return res.end('Error reading files');
        }
    }

    // =====================================================
    // DATA FILES (audio + json)
    // =====================================================
    if (pathname.startsWith('/data/')) {

        const filePath = path.join(ROOT, pathname);

        try {
            const stat = fs.statSync(filePath);

            if (!stat.isFile()) {
                res.writeHead(404);
                return res.end('Not a file');
            }

            const ext = path.extname(filePath);

            res.writeHead(200, {
                'Content-Type': MIME[ext] || 'application/octet-stream'
            });

            return fs.createReadStream(filePath).pipe(res);

        } catch (err) {
            res.writeHead(404);
            return res.end('Not found');
        }
    }

    // =====================================================
    // STATIC CLIENT
    // =====================================================
    if (pathname === '/') {
        pathname = '/index.html';
    }

    const filePath = path.join(CLIENT_DIR, pathname);

    try {
        const stat = fs.statSync(filePath);

        if (!stat.isFile()) {
            res.writeHead(404);
            return res.end('Not found');
        }

        const ext = path.extname(filePath);

        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'text/plain'
        });

        return fs.createReadStream(filePath).pipe(res);

    } catch (err) {
        res.writeHead(404);
        return res.end('Not found');
    }
});

// =========================================================
// START SERVER
// =========================================================
server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
    console.log('ROOT   :', ROOT);
    console.log('DATA   :', DATA_DIR);
    console.log('CLIENT :', CLIENT_DIR);
});