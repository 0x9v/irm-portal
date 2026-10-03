import argparse
import sys
import os

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.database.session import SessionLocal
from app.services.provisioning import appoint_delegate

def main():
    parser = argparse.ArgumentParser(
        description="Owner-operated command to appoint an existing account as the first ACTIVE Delegate of a community."
    )
    parser.add_argument("community_slug", help="The slug of the target community.")
    parser.add_argument("user_id", help="The exact existing User ID (UUID) to appoint.")
    parser.add_argument("--cne", help="The CNE to use if creating or reopening a membership.", default=None)
    parser.add_argument("--apply", action="store_true", help="Actually perform the database mutations (default is dry-run).")
    
    args = parser.parse_args()
    
    print(f"Target Community: {args.community_slug}")
    print(f"Selected Account Identity: {args.user_id}")
    print(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    
    db = SessionLocal()
    try:
        success, message = appoint_delegate(
            db=db,
            community_slug=args.community_slug,
            user_id_str=args.user_id,
            cne=args.cne,
            apply=args.apply
        )
        
        if success:
            print(f"✅ Success: {message}")
            if not args.apply:
                print("   (Dry-run complete. Use --apply to execute.)")
            sys.exit(0)
        else:
            print(f"❌ Blocked: {message}")
            sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
