import logging
import sys
from pathlib import Path

# Add backend directory to path so we can import app
sys.path.append(str(Path(__file__).parent.parent))

from sqlalchemy.orm import Session
from app.models.community import Community
from app.models.module import Module
from app.database.session import SessionLocal

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def seed_db(db: Session) -> None:
    logger.info("Starting seed...")

    # Community
    community_slug = "irm"
    community_name = "FST Mohammedia — IRM"
    
    community = db.query(Community).filter_by(slug=community_slug).first()
    if not community:
        community = Community(name=community_name, slug=community_slug)
        db.add(community)
        db.commit()
        db.refresh(community)
        logger.info(f"Created community: {community_name}")
    else:
        logger.info(f"Community {community_slug} already exists.")
        
    # Modules
    initial_modules = [
        {"name": "Advanced C", "slug": "advanced-c"},
        {"name": "Web Development", "slug": "web-development"},
        {"name": "POO", "slug": "poo"},
    ]
    
    for mod_data in initial_modules:
        module = db.query(Module).filter_by(community_id=community.id, slug=mod_data["slug"]).first()
        if not module:
            module = Module(
                community_id=community.id,
                name=mod_data["name"],
                slug=mod_data["slug"]
            )
            db.add(module)
            logger.info(f"Created module: {mod_data['name']}")
        else:
            logger.info(f"Module {mod_data['slug']} already exists.")
            
    db.commit()
    logger.info("Seed completed.")

def main():
    db = SessionLocal()
    try:
        seed_db(db)
    finally:
        db.close()

if __name__ == "__main__":
    main()
