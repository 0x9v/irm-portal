"""Constants and catalogs for General Discussion."""

from typing import Final

# Small stable catalog of built-in stickers
VALID_STICKERS: Final[list[dict[str, str]]] = [
    {
        "id": "pepe_thumbs_up",
        "name": "Thumbs Up",
        "description": "Classic encouraging thumbs up",
    },
    {
        "id": "cat_heart_eyes",
        "name": "Heart Eyes",
        "description": "Loving heart eyes cat",
    },
    {
        "id": "blob_party",
        "name": "Party",
        "description": "Celebration party blob",
    },
    {
        "id": "doge_classic",
        "name": "Much Wow",
        "description": "Classic doge appreciation",
    },
    {
        "id": "programmer_coffee",
        "name": "Coffee",
        "description": "Hot coffee for coding",
    },
    {
        "id": "rubber_duck_coding",
        "name": "Rubber Duck",
        "description": "Rubber duck debugging",
    },
]

VALID_STICKER_IDS: Final[set[str]] = {s["id"] for s in VALID_STICKERS}

# Initial reaction whitelist
VALID_REACTION_EMOJIS: Final[list[str]] = [
    "thumbs_up",
    "heart",
    "laugh",
    "surprised",
    "sad",
    "thanks",
]

VALID_REACTION_SET: Final[set[str]] = set(VALID_REACTION_EMOJIS)

# Message text length boundaries
MAX_DISCUSSION_MESSAGE_LENGTH: Final[int] = 2000

# Pagination bounds
DEFAULT_DISCUSSION_HISTORY_LIMIT: Final[int] = 30
MAX_DISCUSSION_HISTORY_LIMIT: Final[int] = 50

# WebSocket bounds
WS_REVALIDATION_INTERVAL_SECONDS: Final[int] = 30
WS_QUEUE_MAX_SIZE: Final[int] = 100
