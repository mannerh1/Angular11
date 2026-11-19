from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os
import re
import sqlite3

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "app.db")


def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_circles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                color TEXT NOT NULL CHECK(color IN ('yellow', 'red')),
                x INTEGER NOT NULL,
                y INTEGER NOT NULL,
                size TEXT NOT NULL DEFAULT 'medium' CHECK(size IN ('small', 'medium', 'large'))
            )
            """
        )
        # Ensure existing board_circles table has the size column
        columns = [
            row[1]
            for row in conn.execute("PRAGMA table_info(board_circles)").fetchall()
        ]
        if "size" not in columns:
            conn.execute(
                "ALTER TABLE board_circles ADD COLUMN size TEXT NOT NULL DEFAULT 'medium'"
            )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS board_lines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                orientation TEXT NOT NULL CHECK(orientation IN ('horizontal', 'vertical')),
                position INTEGER NOT NULL,
                thickness TEXT NOT NULL DEFAULT 'medium' CHECK(thickness IN ('thin', 'medium', 'thick'))
            )
            """
        )
        conn.commit()


def get_board_state():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, color, x, y, size FROM board_circles ORDER BY id ASC"
        ).fetchall()
        circles = [dict(row) for row in rows]
        counts = {"yellow": 0, "red": 0}
        for c in circles:
            if c["color"] in counts:
                counts[c["color"]] += 1
        return {"circles": circles, "counts": counts}


def create_circle(color, x, y, size="medium"):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "INSERT INTO board_circles (color, x, y, size) VALUES (?, ?, ?, ?)",
            (color, int(round(x)), int(round(y)), size),
        )
        conn.commit()
        circle_id = cursor.lastrowid
    state = get_board_state()
    created = next(
        (c for c in state["circles"] if c["id"] == circle_id),
        {
            "id": circle_id,
            "color": color,
            "x": int(round(x)),
            "y": int(round(y)),
            "size": size,
        },
    )
    return {"circle": created, "counts": state["counts"]}


def update_circle(circle_id, x, y):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE board_circles SET x = ?, y = ? WHERE id = ?",
            (int(round(x)), int(round(y)), circle_id),
        )
        conn.commit()
        updated = cursor.rowcount > 0
    state = get_board_state()
    return {"updated": updated, "counts": state["counts"]}


def delete_circle(circle_id):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "DELETE FROM board_circles WHERE id = ?",
            (circle_id,),
        )
        conn.commit()
        deleted = cursor.rowcount > 0
    state = get_board_state()
    return {"deleted": deleted, "counts": state["counts"]}


def get_lines_state():
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, orientation, position, thickness FROM board_lines ORDER BY id ASC"
        ).fetchall()
        lines = [dict(row) for row in rows]
        counts = {"horizontal": 0, "vertical": 0}
        for line in lines:
            if line["orientation"] in counts:
                counts[line["orientation"]] += 1
        return {"lines": lines, "counts": counts}


def create_line(orientation, position, thickness):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "INSERT INTO board_lines (orientation, position, thickness) VALUES (?, ?, ?)",
            (orientation, int(round(position)), thickness),
        )
        conn.commit()
        line_id = cursor.lastrowid
    state = get_lines_state()
    created = next(
        (line for line in state["lines"] if line["id"] == line_id),
        {
            "id": line_id,
            "orientation": orientation,
            "position": int(round(position)),
            "thickness": thickness,
        },
    )
    return {"line": created, "counts": state["counts"]}


def update_line(line_id, position):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE board_lines SET position = ? WHERE id = ?",
            (int(round(position)), line_id),
        )
        conn.commit()
        updated = cursor.rowcount > 0
    state = get_lines_state()
    return {"updated": updated, "counts": state["counts"]}


def delete_line(line_id):
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "DELETE FROM board_lines WHERE id = ?",
            (line_id,),
        )
        conn.commit()
        deleted = cursor.rowcount > 0
    state = get_lines_state()
    return {"deleted": deleted, "counts": state["counts"]}


class TacticalBoardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def _send_json(self, data, status=200):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header(
            "Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS"
        )
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(payload)

    def _read_json_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self._send_json({}, status=200)

    def do_GET(self):
        if self.path == "/api/circles":
            self._send_json(get_board_state())
            return
        if self.path == "/api/lines":
            self._send_json(get_lines_state())
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/circles":
            try:
                body = self._read_json_body()
                color = body.get("color")
                x = body.get("x")
                y = body.get("y")
                size = body.get("size", "medium")
                if (
                    color not in ("yellow", "red")
                    or x is None
                    or y is None
                    or size not in ("small", "medium", "large")
                ):
                    self._send_json({"error": "Invalid payload"}, status=400)
                    return
                result = create_circle(color, x, y, size)
                self._send_json(result, status=201)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        if self.path == "/api/lines":
            try:
                body = self._read_json_body()
                orientation = body.get("orientation")
                position = body.get("position")
                thickness = body.get("thickness", "medium")
                if (
                    orientation not in ("horizontal", "vertical")
                    or position is None
                    or thickness not in ("thin", "medium", "thick")
                ):
                    self._send_json({"error": "Invalid line payload"}, status=400)
                    return
                result = create_line(orientation, position, thickness)
                self._send_json(result, status=201)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_PUT(self):
        circle_match = re.match(r"^/api/circles/(\d+)$", self.path)
        if circle_match:
            circle_id = int(circle_match.group(1))
            try:
                body = self._read_json_body()
                x = body.get("x")
                y = body.get("y")
                if x is None or y is None:
                    self._send_json({"error": "Missing x or y"}, status=400)
                    return
                result = update_circle(circle_id, x, y)
                self._send_json(result, status=200)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        line_match = re.match(r"^/api/lines/(\d+)$", self.path)
        if line_match:
            line_id = int(line_match.group(1))
            try:
                body = self._read_json_body()
                position = body.get("position")
                if position is None:
                    self._send_json({"error": "Missing position"}, status=400)
                    return
                result = update_line(line_id, position)
                self._send_json(result, status=200)
            except Exception as exc:
                self._send_json({"error": str(exc)}, status=400)
            return

        self._send_json({"error": "Not found"}, status=404)

    def do_DELETE(self):
        circle_match = re.match(r"^/api/circles/(\d+)$", self.path)
        if circle_match:
            circle_id = int(circle_match.group(1))
            result = delete_circle(circle_id)
            self._send_json(result, status=200)
            return

        line_match = re.match(r"^/api/lines/(\d+)$", self.path)
        if line_match:
            line_id = int(line_match.group(1))
            result = delete_line(line_id)
            self._send_json(result, status=200)
            return

        self._send_json({"error": "Not found"}, status=404)


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 8001))
    server = HTTPServer(("127.0.0.1", port), TacticalBoardHandler)
    print(f"Tactical Board server running at http://127.0.0.1:{port}")
    server.serve_forever()
