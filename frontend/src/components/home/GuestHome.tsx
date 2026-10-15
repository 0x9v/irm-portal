import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import GuestBrandMark from "./GuestBrandMark";
import { HeroArtwork, ResourceArtwork, UpdateArtwork, ParticipationArtwork } from "./GuestLandingArtwork";
import styles from "./GuestLanding.module.css";

export default function GuestHome() {
  return (
    <main className={styles.page} data-guest-home>
      <section className={styles.hero} aria-labelledby="guest-home-heading">
        <header className={styles.heroHeader}>
          <Link href="/" className={styles.brand} aria-label="EtudSup home">
            <GuestBrandMark />
            <span><strong>EtudSup</strong><small>Student learning, connected</small></span>
          </Link>
          <nav className={styles.heroNav} aria-label="Landing navigation">
            <Link href="#communities">Communities</Link>
            <Link href="/support">Support</Link>
            <Link href="/login" className={buttonStyles("secondary", styles.headerSignIn)}>Sign in</Link>
            <Link href="/register" className={buttonStyles("primary", styles.headerCreate)}>Create an account</Link>
          </nav>
        </header>
        <div className={styles.heroBody}>
          <div className={styles.heroCopy}>
            <p className={styles.heroEyebrow}><span aria-hidden="true" />An independent student initiative</p>
            <h1 id="guest-home-heading" tabIndex={-1}>A shared place<br /><span>to learn.</span></h1>
            <p className={styles.lead}>EtudSup brings study resources and student communities together. Start with the IRM space at FST Mohammedia.</p>
            <div className={styles.actions} data-guest-primary-actions>
              <Link href="/login" className={buttonStyles("primary", styles.primary)}>Sign in <span aria-hidden="true">→</span></Link>
              <Link href="/register" className={buttonStyles("secondary", styles.secondary)}>Create an account</Link>
            </div>
          </div>
          <div className={styles.heroArtwork}><HeroArtwork /></div>
        </div>
      </section>

      <section className={styles.communitySection} id="communities" aria-labelledby="communities-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Available today</p>
          <h2 id="communities-heading">A real community to start with.</h2>
          <p>EtudSup can grow to support more student communities. Today, the available space is IRM at FST Mohammedia.</p>
        </div>
        <div className={styles.communityGrid}>
          <article className={styles.irmCard}>
            <div className={styles.irmIdentity}>
              <span className={styles.irmMark} aria-hidden="true">IRM</span>
              <div>
                <p className={styles.irmKicker}>FST Mohammedia · IRM</p>
                <h3>IRM student community</h3>
                <p>Find the real module list after signing in. Active IRM membership opens community updates and participation.</p>
              </div>
            </div>
            <div className={styles.irmActionGroup}>
              <span className={styles.available}><span aria-hidden="true" />Available</span>
              <Link href="/login" className={buttonStyles("secondary", styles.irmAction)}>Sign in to explore IRM <span aria-hidden="true">→</span></Link>
            </div>
          </article>
          <article className={styles.futureCard}>
            <span className={styles.plusMark} aria-hidden="true">+</span>
            <h3>More communities</h3>
            <p>Additional student communities may be introduced in the future.</p>
            <span className={styles.comingSoon}>Coming soon</span>
          </article>
        </div>
      </section>

      <section className={styles.featuresSection} aria-labelledby="features-heading">
        <div className={styles.sectionHeading}>
          <p className={styles.eyebrow}>Inside the IRM community</p>
          <h2 id="features-heading">Your studies. Your community.</h2>
          <p>Start with an account. Community access is confirmed through IRM membership verification.</p>
        </div>
        <div className={styles.featureGrid}>
          <article className={styles.featureCard}>
            <div className={`${styles.featureArt} ${styles.resourceArt}`}><ResourceArtwork /></div>
            <div className={styles.featureCopy}><h3>Study resources</h3><p>Find course materials, tutorials, practical work, and exams organized by module after signing in.</p></div>
          </article>
          <article className={styles.featureCard}>
            <div className={`${styles.featureArt} ${styles.updateArt}`}><UpdateArtwork /></div>
            <div className={styles.featureCopy}><h3>Community updates</h3><p>Read IRM announcements when your account has the required active membership access.</p></div>
          </article>
          <article className={styles.featureCard}>
            <div className={`${styles.featureArt} ${styles.participationArt}`}><ParticipationArtwork /></div>
            <div className={styles.featureCopy}><h3>Participation</h3><p>Ask questions and share with fellow students once your IRM membership has been verified.</p></div>
          </article>
        </div>
      </section>

      <section className={styles.steps} aria-label="How to get started">
        <article><span>01</span><div><h3>Create an account</h3><p>Sign up for EtudSup.</p></div></article>
        <article><span>02</span><div><h3>Request IRM membership</h3><p>Community access is confirmed through manual verification.</p></div></article>
        <article><span>03</span><div><h3>Start learning</h3><p>Browse modules; join community activity once approved.</p></div></article>
      </section>

      <section className={styles.support} aria-labelledby="support-heading">
        <div><h2 id="support-heading">Need help getting started?</h2><p>Find guidance for your account and community membership.</p></div>
        <Link href="/support" className={buttonStyles("secondary")}>Visit Support <span aria-hidden="true">↗</span></Link>
      </section>
    </main>
  );
}
