"""
Smart Legal Document Manager
Flask Backend — uses only stdlib sqlite3 (no extra deps)
"""

import os
import sqlite3
import threading
import logging
import difflib
from datetime import datetime, timezone
from flask import Flask, request, jsonify, render_template, abort

# ─── App Setup ────────────────────────────────────────────
app = Flask(__name__)

BASE_DIR   = os.path.abspath(os.path.dirname(__file__))
INSTANCE   = os.path.join(BASE_DIR, 'instance')
DB_PATH    = os.path.join(INSTANCE, 'legal.db')
LOG_PATH   = os.path.join(INSTANCE, 'notifications.log')

os.makedirs(INSTANCE, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_PATH),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS documents (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
            updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
            is_deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS versions (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id    INTEGER NOT NULL REFERENCES documents(id),
            version_number INTEGER NOT NULL,
            content        TEXT    NOT NULL,
            author         TEXT    NOT NULL,
            change_summary TEXT,
            created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
            is_deleted     INTEGER NOT NULL DEFAULT 0,
            UNIQUE (document_id, version_number)
        );
    """)
    conn.commit()
    conn.close()


def _is_significant_change(old_content, new_content, threshold=0.05):
    old = ' '.join(old_content.split())
    new = ' '.join(new_content.split())
    if old == new:
        return False
    ratio = difflib.SequenceMatcher(None, old, new).ratio()
    return (1 - ratio) > threshold


def _send_notification_async(doc_title, version_number, author, doc_id):
    def _task():
        import time; time.sleep(0.5)
        logger.info(
            "NOTIFICATION | Document: '%s' (ID=%s) | Version %s saved by '%s' | Significant change detected.",
            doc_title, doc_id, version_number, author
        )
    threading.Thread(target=_task, daemon=True).start()


def _compute_diff(old_text, new_text):
    old_lines = old_text.splitlines(keepends=False)
    new_lines = new_text.splitlines(keepends=False)
    matcher   = difflib.SequenceMatcher(None, old_lines, new_lines, autojunk=False)
    result    = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        result.append({
            'type':      tag,
            'old_lines': old_lines[i1:i2],
            'new_lines': new_lines[j1:j2],
            'old_start': i1 + 1,
            'new_start': j1 + 1,
        })
    stats = {
        'added':   sum(len(b['new_lines']) for b in result if b['type'] == 'insert'),
        'removed': sum(len(b['old_lines']) for b in result if b['type'] == 'delete'),
        'changed': sum(max(len(b['old_lines']), len(b['new_lines'])) for b in result if b['type'] == 'replace'),
    }
    return result, stats


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/documents', methods=['GET'])
def list_documents():
    conn = get_db()
    rows = conn.execute("""
        SELECT d.id, d.title, d.created_at, d.updated_at,
               COUNT(v.id) AS version_count,
               MAX(v.version_number) AS latest_version
        FROM documents d
        LEFT JOIN versions v ON v.document_id = d.id AND v.is_deleted = 0
        WHERE d.is_deleted = 0
        GROUP BY d.id
        ORDER BY d.updated_at DESC
    """).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/documents', methods=['POST'])
def create_document():
    data    = request.get_json(force=True)
    title   = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    author  = (data.get('author') or 'Anonymous').strip()
    summary = (data.get('change_summary') or 'Initial version').strip()

    if not title or not content:
        return jsonify({'error': 'title and content are required'}), 400

    now  = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
    conn = get_db()
    try:
        cur    = conn.execute("INSERT INTO documents (title, created_at, updated_at) VALUES (?,?,?)", (title, now, now))
        doc_id = cur.lastrowid
        conn.execute("INSERT INTO versions (document_id, version_number, content, author, change_summary, created_at) VALUES (?,1,?,?,?,?)",
                     (doc_id, content, author, summary, now))
        conn.commit()
        doc = dict(conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone())
        ver = dict(conn.execute("SELECT * FROM versions WHERE document_id=? AND version_number=1", (doc_id,)).fetchone())
        doc['version_count']  = 1
        doc['latest_version'] = 1
        _send_notification_async(title, 1, author, doc_id)
        return jsonify({'document': doc, 'version': ver}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({'error': 'Database error'}), 500
    finally:
        conn.close()


@app.route('/api/documents/<int:doc_id>', methods=['GET'])
def get_document(doc_id):
    conn = get_db()
    doc  = conn.execute("SELECT * FROM documents WHERE id=? AND is_deleted=0", (doc_id,)).fetchone()
    if not doc:
        conn.close(); abort(404)
    versions = conn.execute("SELECT * FROM versions WHERE document_id=? AND is_deleted=0 ORDER BY version_number DESC", (doc_id,)).fetchall()
    conn.close()
    d = dict(doc)
    d['version_count']  = len(versions)
    d['latest_version'] = versions[0]['version_number'] if versions else None
    return jsonify({'document': d, 'versions': [dict(v) for v in versions]})


@app.route('/api/documents/<int:doc_id>/title', methods=['PATCH'])
def update_title(doc_id):
    conn = get_db()
    doc  = conn.execute("SELECT id FROM documents WHERE id=? AND is_deleted=0", (doc_id,)).fetchone()
    if not doc:
        conn.close(); abort(404)
    data  = request.get_json(force=True)
    title = (data.get('title') or '').strip()
    if not title:
        conn.close(); return jsonify({'error': 'title is required'}), 400
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
    conn.execute("UPDATE documents SET title=?, updated_at=? WHERE id=?", (title, now, doc_id))
    conn.commit()
    d  = dict(conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone())
    vc = conn.execute("SELECT COUNT(*),MAX(version_number) FROM versions WHERE document_id=? AND is_deleted=0", (doc_id,)).fetchone()
    conn.close()
    d['version_count']  = vc[0]
    d['latest_version'] = vc[1]
    return jsonify({'document': d})


@app.route('/api/documents/<int:doc_id>', methods=['DELETE'])
def delete_document(doc_id):
    conn = get_db()
    doc  = conn.execute("SELECT id FROM documents WHERE id=? AND is_deleted=0", (doc_id,)).fetchone()
    if not doc:
        conn.close(); abort(404)
    conn.execute("UPDATE documents SET is_deleted=1 WHERE id=?", (doc_id,))
    conn.execute("UPDATE versions SET is_deleted=1 WHERE document_id=?", (doc_id,))
    conn.commit(); conn.close()
    return jsonify({'message': f'Document {doc_id} deleted.'})


@app.route('/api/documents/<int:doc_id>/versions', methods=['POST'])
def add_version(doc_id):
    conn = get_db()
    doc  = conn.execute("SELECT * FROM documents WHERE id=? AND is_deleted=0", (doc_id,)).fetchone()
    if not doc:
        conn.close(); abort(404)

    data    = request.get_json(force=True)
    content = (data.get('content') or '').strip()
    author  = (data.get('author') or 'Anonymous').strip()
    summary = (data.get('change_summary') or '').strip()

    if not content:
        conn.close(); return jsonify({'error': 'content is required'}), 400

    latest = conn.execute("SELECT * FROM versions WHERE document_id=? AND is_deleted=0 ORDER BY version_number DESC LIMIT 1", (doc_id,)).fetchone()

    if latest and latest['content'].strip() == content:
        conn.close()
        return jsonify({'error': 'Content is identical to the current version. No new version saved.'}), 409

    new_num = (latest['version_number'] + 1) if latest else 1
    summary = summary or f'Version {new_num}'
    now     = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')

    try:
        conn.execute("INSERT INTO versions (document_id, version_number, content, author, change_summary, created_at) VALUES (?,?,?,?,?,?)",
                     (doc_id, new_num, content, author, summary, now))
        conn.execute("UPDATE documents SET updated_at=? WHERE id=?", (now, doc_id))
        conn.commit()
        ver = dict(conn.execute("SELECT * FROM versions WHERE document_id=? AND version_number=?", (doc_id, new_num)).fetchone())

        if latest and _is_significant_change(latest['content'], content):
            _send_notification_async(doc['title'], new_num, author, doc_id)

        return jsonify({'version': ver}), 201
    except Exception as e:
        conn.rollback()
        return jsonify({'error': 'Database error'}), 500
    finally:
        conn.close()


@app.route('/api/documents/<int:doc_id>/versions/<int:ver_num>', methods=['DELETE'])
def delete_version(doc_id, ver_num):
    conn  = get_db()
    ver   = conn.execute("SELECT id FROM versions WHERE document_id=? AND version_number=? AND is_deleted=0", (doc_id, ver_num)).fetchone()
    if not ver:
        conn.close(); abort(404)
    count = conn.execute("SELECT COUNT(*) FROM versions WHERE document_id=? AND is_deleted=0", (doc_id,)).fetchone()[0]
    if count <= 1:
        conn.close()
        return jsonify({'error': 'Cannot delete the only remaining version. Delete the whole document instead.'}), 400
    conn.execute("UPDATE versions SET is_deleted=1 WHERE id=?", (ver['id'],))
    conn.commit(); conn.close()
    return jsonify({'message': f'Version {ver_num} deleted.'})


@app.route('/api/documents/<int:doc_id>/diff', methods=['GET'])
def diff_versions(doc_id):
    conn = get_db()
    if not conn.execute("SELECT id FROM documents WHERE id=? AND is_deleted=0", (doc_id,)).fetchone():
        conn.close(); abort(404)
    v1_num = request.args.get('v1', type=int)
    v2_num = request.args.get('v2', type=int)
    if v1_num is None or v2_num is None:
        conn.close(); return jsonify({'error': 'v1 and v2 query params required'}), 400
    v1 = conn.execute("SELECT * FROM versions WHERE document_id=? AND version_number=?", (doc_id, v1_num)).fetchone()
    v2 = conn.execute("SELECT * FROM versions WHERE document_id=? AND version_number=?", (doc_id, v2_num)).fetchone()
    conn.close()
    if not v1 or not v2:
        abort(404)
    hunks, stats = _compute_diff(v1['content'], v2['content'])
    return jsonify({
        'version_from': dict(v1),
        'version_to':   dict(v2),
        'is_identical': v1['content'].strip() == v2['content'].strip(),
        'stats':        stats,
        'hunks':        hunks,
    })


@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    if not os.path.exists(LOG_PATH):
        return jsonify({'notifications': []})
    with open(LOG_PATH) as f:
        lines = f.readlines()
    last_50 = [l.strip() for l in lines[-50:] if 'NOTIFICATION' in l]
    last_50.reverse()
    return jsonify({'notifications': last_50})


init_db()

if __name__ == '__main__':
    app.run(debug=True, port=5000)
