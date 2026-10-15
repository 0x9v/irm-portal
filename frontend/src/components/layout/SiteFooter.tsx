import styles from "./SiteFooter.module.css";

/** The root layout supplies one year for every shell branch and hydration. */
export default function SiteFooter({ year }: { year: number }) {
  return (
    <footer data-site-footer className={styles.footer}>
      <p>© {year} EtudSup · v0.1 · All rights reserved.</p>
    </footer>
  );
}
