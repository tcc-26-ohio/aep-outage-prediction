"""Demo API. No live forecasts, real customer records, or notification delivery."""

import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, EmailStr, Field

app = FastAPI(title="GridAhead API", version="0.1.0")
DATABASE = Path(__file__).resolve().parents[1] / "storage" / "subscriptions.sqlite3"
DEMO_PREMISES = {
    "DEMO-001": ("Roanoke, VA", "DEMO-CIRCUIT-01", "Elevated"),
    "DEMO-002": ("Vinton, VA", "DEMO-CIRCUIT-02", "High"),
    "DEMO-003": ("Salem, VA", "DEMO-CIRCUIT-03", "Low"),
}


class Assessment(BaseModel):
    premise: str
    location: str
    circuit: str
    risk: str
    window: str
    drivers: list[str]
    restoration: str
    preparation: list[str]
    eligible: bool
    demo: bool = True


class Subscription(BaseModel):
    premise: str = Field(min_length=1, max_length=40)
    email: EmailStr
    consent: bool


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "demo", "model_loaded": False}


@app.get("/api/assessments/{premise}", response_model=Assessment)
def assess(premise: str):
    if premise not in DEMO_PREMISES:
        raise HTTPException(404, "Unknown demo premise. Use DEMO-001, DEMO-002, or DEMO-003.")
    location, circuit, risk = DEMO_PREMISES[premise]
    return Assessment(
        premise=premise, location=location, circuit=circuit, risk=risk,
        window="Illustrative 24-hour wind event",
        drivers=["Illustrative strong wind exposure", "Demo circuit infrastructure profile"],
        restoration="If an outage occurs, plan for several hours without power. Widespread damage could extend disruptions. No trained restoration estimate is available.",
        preparation=[
            "Charge phones and portable battery packs.",
            "Keep flashlights, water, and essential supplies accessible.",
            "Review backup arrangements for powered medical equipment.",
            "Never operate a generator indoors or near doors and windows.",
        ],
        eligible=True,
    )


@app.post("/api/subscriptions", status_code=201)
def subscribe(subscription: Subscription):
    if subscription.premise not in DEMO_PREMISES:
        raise HTTPException(404, "Unknown demo premise.")
    if not subscription.consent:
        raise HTTPException(400, "Explicit consent is required.")
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE) as connection:
        connection.execute("""CREATE TABLE IF NOT EXISTS subscriptions (
            premise TEXT NOT NULL, email TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(premise, email)
        )""")
        connection.execute(
            "INSERT OR IGNORE INTO subscriptions (premise, email) VALUES (?, ?)",
            (subscription.premise, str(subscription.email)),
        )
    return {"message": "Demo enrollment saved locally. No emails will be sent."}
