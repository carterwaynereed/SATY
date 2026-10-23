"""Generate the small exchange-session table used by the dependency-free Worker."""
import json
from pathlib import Path
import exchange_calendars as xcals
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
calendar = xcals.get_calendar('XNYS', start='2026-01-01', end='2027-12-31')
sessions = {}
for label, row in calendar.schedule.iterrows():
    close = row['close'].to_pydatetime()
    sessions[str(label.date())] = {
        'open': row['open'].isoformat(), 'close': row['close'].isoformat(),
        'early_close': close.astimezone(ZoneInfo('America/New_York')).hour < 16,
    }
out = ROOT / 'hosting/session-calendar.json'
out.write_text(json.dumps({'calendar': 'XNYS', 'sessions': sessions}, separators=(',', ':')) + '\n')
print(f'Exchange calendar: {len(sessions)} sessions, 2026–2027')
