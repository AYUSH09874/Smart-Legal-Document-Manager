# LexVault — Smart Legal Document Manager
## User Guide & Feature Walkthrough

---

## Setup

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run the server
python app.py

# 3. Open your browser
http://localhost:5000
```

No database setup needed — SQLite is auto-created at `instance/legal.db` on first run.

---

## Feature Walkthrough

### 1. Creating a New Document

1. Enter your name in the **"Your name…"** box in the top-right (e.g. `Advocate Singh`).
2. Click the **"+ New"** button in the sidebar.
3. Fill in:
   - **Title** — e.g. `Non-Disclosure Agreement — Acme Corp`
   - **Content** — paste or type the full document text
   - **Change Summary** — e.g. `Initial draft`
4. Click **"Create Document"**.

✅ The document appears in the sidebar immediately.  
✅ Version 1 is created, timestamped, and attributed to your name.

---

### 2. Saving a New Version (Update / Edit)

1. Click a document in the sidebar to open it.
2. Click the **"Edit / New Version"** tab.
3. Modify the content (e.g. change a clause).
4. Optionally fill in **Change Summary** (e.g. `Amended clause 4.2`).
5. Click **"Save New Version"**.

✅ The old content is **never overwritten** — a brand-new version row is inserted.  
✅ If content is identical, the system rejects it with `409 Conflict`.  
✅ Version counter in the sidebar updates instantly.

---

### 3. Comparing Two Versions (Diff)

1. Open a document with at least 2 versions.
2. Click the **"Compare"** tab.
3. Choose **"From Version"** (older) and **"To Version"** (newer) from the dropdowns.
4. Click **"Compare"**.

The viewer shows:
- 🟢 **Green lines with `+`** — lines that were **added**
- 🔴 **Red strikethrough lines with `−`** — lines that were **removed**
- 🟡 **Yellow lines showing both** — lines that were **changed/replaced**
- Context lines (unchanged) for readability
- A **stats bar** at the top showing count of added / removed / changed lines

---

### 4. Smart Notifications

Notifications fire automatically in the **background** when a new version with a **significant change** (>5% content difference) is saved.

To view the notification log:
1. Click **"Notifications"** in the top nav.
2. Click **"↻ Refresh"** to load latest entries.

Notification format:
```
📧 NOTIFICATION | Document: 'NDA — Acme Corp' (ID=1) | Version 3 saved by 'Advocate Singh' | Significant change detected.
```

The log is also written to `instance/notifications.log`.  
**The upload response is instant** — the notification runs in a separate thread.

---

### 5. Updating the Document Title

1. Open a document.
2. Click the **✎ (pencil)** icon next to the title.
3. Enter the new title and click **"Update Title"**.

✅ **No new version is created** — only the document's `title` field is updated.  
✅ All versions and history remain intact.

---

### 6. Deleting a Version (not the whole document)

1. Open a document → **"History"** tab.
2. Click **"View"** on any version.
3. In the modal, click **"Delete This Version"**.

- The version is **soft-deleted** (marked `is_deleted=True`, row kept for audit trail).
- If it's the **only** version, deletion is blocked — you must delete the whole document instead.

---

### 7. Deleting an Entire Document

1. Open a document → **"Edit / New Version"** tab.
2. Click **"Delete Document"** (red outlined button, bottom right).
3. Confirm the prompt.

✅ All versions are soft-deleted.  
✅ The document disappears from the sidebar.

---

## How the Comparison (Diff) Works

The comparison uses Python's built-in `difflib.SequenceMatcher`, which implements the **Ratcliff/Obershelp** algorithm — the same algorithm that powers `git diff`.

**Steps:**
1. Both version contents are split into **lines** (by newline `\n`).
2. `SequenceMatcher.get_opcodes()` returns a list of operations: `equal`, `insert`, `delete`, `replace`.
3. Each operation is turned into a "hunk" with line numbers, signs (`+`/`−`), and color coding.
4. Equal sections are **collapsed** (showing max 2 context lines) to keep the view readable.
5. The stats bar counts lines per operation type.

**Significant Change Detection** (for notifications):  
Uses the same `SequenceMatcher.ratio()` — if the documents are less than **95% similar**, a notification fires. Whitespace-only changes are ignored by stripping and normalizing whitespace before comparison.

---

## API Reference (for developers)

| Method | Endpoint | Action |
|--------|----------|--------|
| GET    | `/api/documents` | List all documents |
| POST   | `/api/documents` | Create document + v1 |
| GET    | `/api/documents/:id` | Get doc + all versions |
| PATCH  | `/api/documents/:id/title` | Update title only |
| DELETE | `/api/documents/:id` | Soft-delete document |
| POST   | `/api/documents/:id/versions` | Add new version |
| DELETE | `/api/documents/:id/versions/:num` | Soft-delete one version |
| GET    | `/api/documents/:id/diff?v1=1&v2=3` | Compare two versions |
| GET    | `/api/notifications` | Get notification log |

---

## Data Safety

- All writes use **SQLAlchemy transactions** — if a crash occurs mid-save, the DB rolls back automatically.
- Versions are **append-only** — the original content is never mutated.
- Deletes are **soft** — data is flagged `is_deleted=True`, not physically removed.
