import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import styles from "./HomeDashboard.module.css";

export default function HomeWelcomeHero({ username }: { username: string }) {
  return (
    <section aria-labelledby="home-heading" className={styles.accountHero}>
      <div className={styles.accountHeroCopy}>
        <p className={styles.accountEyebrow}>EtudSup <span aria-hidden="true">·</span> IRM community</p>
        <p className={styles.accountWelcome}>Welcome back.</p>
        <h1 id="home-heading">Your resources.<br /><span>Your people.</span></h1>
        <p className={styles.accountIdentity}>Signed in as <strong>@{username}</strong></p>
        <p className={styles.accountLead}>Study resources and your IRM community, together in one place.</p>
        <Link href="/communities/irm/modules" className={buttonStyles("primary", styles.accountHeroAction)}>Browse modules<span aria-hidden="true">→</span></Link>
      </div>
      <div className={styles.accountArtwork} aria-hidden="true">
        <svg viewBox="0 0 260 230" fill="none">
          <circle cx="130" cy="110" r="100" stroke="currentColor" opacity=".16" />
          <path d="M207 43a100 100 0 0 1 15 118M40 166a100 100 0 0 0 118 38" stroke="currentColor" strokeDasharray="3 5" opacity=".5" />
          <g fill="#ffffff05" stroke="currentColor" strokeOpacity=".5" strokeWidth="1.5">
            <path d="M60 58h66a18 18 0 0 1 18 18v25a18 18 0 0 1-18 18h-26l-18 16v-16H60a18 18 0 0 1-18-18V76a18 18 0 0 1 18-18Z" />
            <path d="M139 112h67a18 18 0 0 1 18 18v24a18 18 0 0 1-18 18h-12l-18 15v-15h-37a18 18 0 0 1-18-18v-24a18 18 0 0 1 18-18Z" />
          </g>
          <path d="M70 80h35m-35 14h55m26 39h33m-33 14h48" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="113" cy="80" r="3" fill="currentColor" />
          <circle cx="192" cy="133" r="3" fill="currentColor" />
        </svg>
        <span>IRM · FST Mohammedia</span>
      </div>
    </section>
  );
}
