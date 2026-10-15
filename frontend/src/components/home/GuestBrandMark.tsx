import type { SVGProps } from "react";

/** Shared EtudSup monogram used by the public and authenticated shells. */
export default function GuestBrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" {...props}>
      <rect x="2" y="2" width="36" height="36" rx="11" fill="#24212A" stroke="#625B6B" />
      <path d="M15 12h11M15 20h9M15 28h11M15 12v16" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
