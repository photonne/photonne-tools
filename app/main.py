"""
photonne-tools — herramienta web para ejecutar rsync, exiftool y similares en el NAS.
v0.1: file browser integrado para elegir paths con clicks.
"""
import asyncio
import os
import secrets
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, field_validator

# ============================================================
# Configuración
# ============================================================

DB_PATH = os.environ.get("PHOTONNE_TOOLS_DB", "/data/photonne-tools.db")
LOG_DIR = Path(os.environ.get("PHOTONNE_TOOLS_LOGS", "/data/logs"))
LOG_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_ROOTS = [
    Path(p).resolve()
    for p in os.environ.get(
        "PHOTONNE_TOOLS_ALLOWED_ROOTS",
        "/media/HDD,/data,/DATA"
    ).split(",")
    if p.strip()
]

AUTH_USER = os.environ.get("PHOTONNE_TOOLS_USER", "admin")
AUTH_PASS = os.environ.get("PHOTONNE_TOOLS_PASS", "changeme")

running_jobs: dict[str, asyncio.subprocess.Process] = {}


# ============================================================
# Base de datos
# ============================================================

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            tool TEXT NOT NULL,
            config TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            job_id TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            exit_code INTEGER,
            log_path TEXT NOT NULL,
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_runs_job_id ON runs(job_id);
        CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
    """)
    conn.commit()
    conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


# ============================================================
# App FastAPI
# ============================================================

app = FastAPI(title="photonne-tools", lifespan=lifespan)

BASE_DIR = Path(__file__).parent
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")
templates = Jinja2Templates(directory=BASE_DIR / "templates")
security = HTTPBasic()


def require_auth(credentials: HTTPBasicCredentials = Depends(security)):
    user_ok = secrets.compare_digest(credentials.username, AUTH_USER)
    pass_ok = secrets.compare_digest(credentials.password, AUTH_PASS)
    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username


# ============================================================
# Validación de paths
# ============================================================

def is_path_allowed(path: Path) -> bool:
    try:
        resolved = path.resolve()
    except (OSError, ValueError):
        return False
    return any(
        resolved == root or root in resolved.parents
        for root in ALLOWED_ROOTS
    )


def validate_path(path_str: str, must_exist: bool = True) -> Path:
    if not path_str:
        raise ValueError("Path vacío")
    try:
        path = Path(path_str).resolve()
    except (OSError, ValueError) as e:
        raise ValueError(f"Path inválido: {e}")

    if not is_path_allowed(path):
        raise ValueError(
            f"Path fuera de directorios permitidos. "
            f"Permitidos: {', '.join(str(r) for r in ALLOWED_ROOTS)}"
        )
    if must_exist and not path.exists():
        raise ValueError(f"Path no existe: {path}")
    return path


# ============================================================
# Modelos Pydantic
# ============================================================

class RsyncConfig(BaseModel):
    source: str
    destination: str
    flags: str = "-av"
    dry_run: bool = False
    delete: bool = False

    @field_validator("source", "destination")
    @classmethod
    def validate_paths(cls, v: str) -> str:
        return v.strip()


class ExiftoolConfig(BaseModel):
    target: str
    mode: str = "repair_mtime"
    custom_args: str = ""
    recursive: bool = True
    dry_run: bool = False

    @field_validator("mode")
    @classmethod
    def validate_mode(cls, v: str) -> str:
        if v not in ("repair_mtime", "custom"):
            raise ValueError("mode debe ser 'repair_mtime' o 'custom'")
        return v


class JobCreate(BaseModel):
    name: str
    tool: str
    config: dict

    @field_validator("tool")
    @classmethod
    def validate_tool(cls, v: str) -> str:
        if v not in ("rsync", "exiftool"):
            raise ValueError("tool debe ser 'rsync' o 'exiftool'")
        return v


# ============================================================
# Builders de comandos
# ============================================================

def build_rsync_command(config: dict) -> list[str]:
    rcfg = RsyncConfig(**config)
    src = validate_path(rcfg.source, must_exist=True)

    dst_str = rcfg.destination.rstrip("/")
    dst_check_path = Path(dst_str).resolve() if dst_str else None
    if dst_check_path is None or not is_path_allowed(dst_check_path):
        raise ValueError(
            f"Destino fuera de directorios permitidos. "
            f"Permitidos: {', '.join(str(r) for r in ALLOWED_ROOTS)}"
        )

    flags = rcfg.flags.split() if rcfg.flags else ["-av"]
    safe_flags = [
        f for f in flags
        if not f.startswith("--rsh") and not f.startswith("-e") and f != "--rsync-path"
    ]

    cmd = ["rsync"] + safe_flags + ["--progress"]
    if rcfg.dry_run:
        cmd.append("--dry-run")
    if rcfg.delete:
        cmd.append("--delete")

    src_arg = str(src) + ("/" if rcfg.source.endswith("/") else "")
    dst_arg = rcfg.destination if rcfg.destination.endswith("/") else rcfg.destination + "/"

    cmd.extend([src_arg, dst_arg])
    return cmd


def build_exiftool_command(config: dict) -> list[str]:
    ecfg = ExiftoolConfig(**config)
    target = validate_path(ecfg.target, must_exist=True)

    cmd = ["exiftool"]
    if ecfg.recursive:
        cmd.append("-r")

    if ecfg.mode == "repair_mtime":
        cmd.extend([
            "-FileModifyDate<DateTimeOriginal",
            "-FileModifyDate<CreateDate",
            "-FileModifyDate<MediaCreateDate",
            "-overwrite_original",
        ])
    else:
        if ecfg.custom_args:
            args = ecfg.custom_args.split()
            cmd.extend(args)

    if ecfg.dry_run:
        cmd.append("-v0")
        cmd.append("-list")

    cmd.append(str(target))
    return cmd


# ============================================================
# Ejecución de jobs
# ============================================================

async def run_job_async(job_id: str, run_id: str, cmd: list[str], log_path: Path):
    conn = get_db()
    try:
        with open(log_path, "w", encoding="utf-8") as log_file:
            log_file.write(f"=== photonne-tools run {run_id} ===\n")
            log_file.write(f"Job: {job_id}\n")
            log_file.write(f"Comando: {' '.join(cmd)}\n")
            log_file.write(f"Iniciado: {datetime.now().isoformat()}\n")
            log_file.write("=" * 60 + "\n\n")
            log_file.flush()

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            running_jobs[run_id] = proc

            async for line in proc.stdout:
                try:
                    decoded = line.decode("utf-8", errors="replace")
                except Exception:
                    decoded = str(line)
                log_file.write(decoded)
                log_file.flush()

            exit_code = await proc.wait()
            log_file.write(f"\n{'=' * 60}\n")
            log_file.write(f"Finalizado: {datetime.now().isoformat()}\n")
            log_file.write(f"Exit code: {exit_code}\n")

        status_str = "success" if exit_code == 0 else "failed"
        conn.execute(
            "UPDATE runs SET status = ?, finished_at = ?, exit_code = ? WHERE id = ?",
            (status_str, datetime.now().isoformat(), exit_code, run_id),
        )
        conn.commit()
    except Exception as e:
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write(f"\n\nERROR ejecutando job: {e}\n")
        conn.execute(
            "UPDATE runs SET status = ?, finished_at = ?, exit_code = ? WHERE id = ?",
            ("error", datetime.now().isoformat(), -1, run_id),
        )
        conn.commit()
    finally:
        running_jobs.pop(run_id, None)
        conn.close()


# ============================================================
# Endpoints
# ============================================================

@app.get("/", response_class=HTMLResponse)
async def index(request: Request, _: str = Depends(require_auth)):
    return templates.TemplateResponse(request, "index.html", {"allowed_roots": [str(r) for r in ALLOWED_ROOTS]})


# ---------- File browser ----------

@app.get("/api/roots")
async def list_roots(_: str = Depends(require_auth)):
    """Devuelve los directorios raíz permitidos para el file browser."""
    roots = []
    for r in ALLOWED_ROOTS:
        exists = r.exists()
        roots.append({
            "path": str(r),
            "name": r.name or str(r),
            "exists": exists,
            "is_dir": r.is_dir() if exists else False,
        })
    return {"roots": roots}


@app.get("/api/files")
async def list_files(path: str = Query(...), _: str = Depends(require_auth)):
    """Lista contenido de un directorio con validación de allowlist."""
    try:
        target = Path(path).resolve()
    except (OSError, ValueError) as e:
        raise HTTPException(400, f"Path inválido: {e}")

    if not is_path_allowed(target):
        raise HTTPException(403, "Path fuera de directorios permitidos")

    if not target.exists():
        raise HTTPException(404, "Path no existe")

    if not target.is_dir():
        raise HTTPException(400, "Path no es un directorio")

    entries = []
    try:
        for entry in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
            try:
                is_dir = entry.is_dir()
                stat = entry.stat()
                entries.append({
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": is_dir,
                    "size": stat.st_size if not is_dir else None,
                    "modified": stat.st_mtime,
                })
            except (OSError, PermissionError):
                entries.append({
                    "name": entry.name,
                    "path": str(entry),
                    "is_dir": False,
                    "size": None,
                    "modified": None,
                    "error": "inaccesible",
                })
    except PermissionError:
        raise HTTPException(403, "Sin permisos de lectura en este directorio")

    parent = target.parent
    parent_str = None
    if target != target.parent and is_path_allowed(parent):
        parent_str = str(parent)

    return {
        "path": str(target),
        "parent": parent_str,
        "entries": entries,
    }


# ---------- Jobs ----------

@app.get("/api/jobs")
async def list_jobs(_: str = Depends(require_auth)):
    conn = get_db()
    rows = conn.execute("""
        SELECT j.*,
               (SELECT status FROM runs WHERE job_id = j.id ORDER BY started_at DESC LIMIT 1) as last_status,
               (SELECT started_at FROM runs WHERE job_id = j.id ORDER BY started_at DESC LIMIT 1) as last_run
        FROM jobs j
        ORDER BY j.updated_at DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.post("/api/jobs")
async def create_job(job: JobCreate, _: str = Depends(require_auth)):
    import json

    try:
        if job.tool == "rsync":
            build_rsync_command(job.config)
        elif job.tool == "exiftool":
            build_exiftool_command(job.config)
    except (ValueError, Exception) as e:
        raise HTTPException(status_code=400, detail=f"Configuración inválida: {e}")

    job_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    conn = get_db()
    conn.execute(
        "INSERT INTO jobs (id, name, tool, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (job_id, job.name, job.tool, json.dumps(job.config), now, now),
    )
    conn.commit()
    conn.close()
    return {"id": job_id, "name": job.name, "tool": job.tool, "config": job.config}


@app.delete("/api/jobs/{job_id}")
async def delete_job(job_id: str, _: str = Depends(require_auth)):
    conn = get_db()
    conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    conn.commit()
    conn.close()
    return {"deleted": job_id}


@app.post("/api/jobs/{job_id}/run")
async def run_job(job_id: str, _: str = Depends(require_auth)):
    import json
    conn = get_db()
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Job no encontrado")

    config = json.loads(row["config"])
    try:
        if row["tool"] == "rsync":
            cmd = build_rsync_command(config)
        elif row["tool"] == "exiftool":
            cmd = build_exiftool_command(config)
        else:
            raise HTTPException(400, f"Tool no soportada: {row['tool']}")
    except ValueError as e:
        raise HTTPException(400, str(e))

    run_id = str(uuid.uuid4())
    log_path = LOG_DIR / f"{run_id}.log"
    conn.execute(
        "INSERT INTO runs (id, job_id, status, started_at, log_path) VALUES (?, ?, ?, ?, ?)",
        (run_id, job_id, "running", datetime.now().isoformat(), str(log_path)),
    )
    conn.commit()
    conn.close()

    asyncio.create_task(run_job_async(job_id, run_id, cmd, log_path))

    return {"run_id": run_id, "command": " ".join(cmd)}


@app.post("/api/runs/{run_id}/stop")
async def stop_run(run_id: str, _: str = Depends(require_auth)):
    proc = running_jobs.get(run_id)
    if not proc:
        raise HTTPException(404, "Run no está corriendo")
    proc.terminate()
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        proc.kill()
    return {"stopped": run_id}


@app.get("/api/runs")
async def list_runs(job_id: Optional[str] = None, limit: int = 50, _: str = Depends(require_auth)):
    conn = get_db()
    if job_id:
        rows = conn.execute(
            "SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC LIMIT ?",
            (job_id, limit),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM runs ORDER BY started_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@app.get("/api/runs/{run_id}/log")
async def get_log(run_id: str, _: str = Depends(require_auth)):
    conn = get_db()
    row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Run no encontrado")
    log_path = Path(row["log_path"])
    if not log_path.exists():
        return {"content": "(log no disponible)"}
    return {"content": log_path.read_text(encoding="utf-8", errors="replace")}


@app.get("/api/runs/{run_id}/stream")
async def stream_log(run_id: str, _: str = Depends(require_auth)):
    conn = get_db()
    row = conn.execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Run no encontrado")
    log_path = Path(row["log_path"])

    async def generate():
        for _ in range(30):
            if log_path.exists():
                break
            await asyncio.sleep(0.5)
        if not log_path.exists():
            yield "data: (log no se generó)\n\n"
            return

        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            while True:
                line = f.readline()
                if line:
                    yield f"data: {line.rstrip()}\n\n"
                else:
                    conn2 = get_db()
                    row2 = conn2.execute(
                        "SELECT status FROM runs WHERE id = ?", (run_id,)
                    ).fetchone()
                    conn2.close()
                    if row2 and row2["status"] != "running":
                        yield "data: [FINALIZADO]\n\n"
                        break
                    await asyncio.sleep(1)

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})
