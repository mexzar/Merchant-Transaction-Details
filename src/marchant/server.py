"""FastAPI app serving the local web UI and the scrape/config API."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from starlette.requests import Request

from . import __version__
from .config import AppConfig, export_dir, load_config, save_config
from .exporter import write_export
from .scraper import TIME_RANGES, ScrapeError, scrape

_PKG_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(_PKG_DIR / "templates"))

app = FastAPI(title="Marchant Transaction Details", version=__version__)
app.mount("/static", StaticFiles(directory=str(_PKG_DIR / "static")), name="static")


class ScrapeRequest(BaseModel):
    email: str
    password: str
    otp: Optional[str] = None
    otp_secret_key: Optional[str] = None
    time_range: str = "months-3"
    year: Optional[int] = None
    full_details: bool = True
    include_orders: bool = True
    include_transactions: bool = True


@app.get("/", response_class=HTMLResponse)
def index(request: Request) -> HTMLResponse:
    config = load_config()
    ranges = [{"key": k, "label": v["label"]} for k, v in TIME_RANGES.items()]
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "version": __version__,
            "ranges": ranges,
            "config": config,
        },
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "version": __version__}


@app.get("/api/config")
def get_config() -> AppConfig:
    return load_config()


@app.post("/api/config")
def update_config(payload: AppConfig) -> AppConfig:
    save_config(payload)
    return payload


@app.post("/api/scrape")
def run_scrape(req: ScrapeRequest) -> JSONResponse:
    if not req.include_orders and not req.include_transactions:
        raise HTTPException(status_code=400, detail="Select orders, transactions, or both.")
    try:
        result = scrape(
            req.email,
            req.password,
            otp=req.otp,
            otp_secret_key=req.otp_secret_key,
            time_range=req.time_range,
            year=req.year,
            full_details=req.full_details,
            include_orders=req.include_orders,
            include_transactions=req.include_transactions,
        )
    except ScrapeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    config = load_config()
    out_path = write_export(result, export_dir(config))

    return JSONResponse(
        {
            "result": result.model_dump(mode="json"),
            "filename": out_path.name,
            "export_path": str(out_path),
        }
    )


@app.get("/download/{filename}")
def download(filename: str) -> FileResponse:
    # Guard against path traversal: only serve a bare filename from the export dir.
    if "/" in filename or "\\" in filename or filename in ("..", "."):
        raise HTTPException(status_code=400, detail="Invalid filename.")
    config = load_config()
    path = export_dir(config) / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Export not found.")
    return FileResponse(path, media_type="application/json", filename=filename)
