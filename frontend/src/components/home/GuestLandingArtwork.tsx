/** Decorative, abstract interface studies. They contain no live student data. */
export function HeroArtwork() {
  return (
    <svg viewBox="0 0 540 440" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="landing-frame" x1="52" y1="50" x2="500" y2="410" gradientUnits="userSpaceOnUse">
          <stop stopColor="#393342" /><stop offset="1" stopColor="#222027" />
        </linearGradient>
        <linearGradient id="landing-tile" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#8068D7" /><stop offset="1" stopColor="#4934A0" />
        </linearGradient>
      </defs>
      <rect x="49" y="70" width="465" height="334" rx="28" fill="url(#landing-frame)" stroke="#655F6E" />
      <path d="M49 108H514M164 108V404" stroke="#575260" />
      <circle cx="71" cy="89" r="4" fill="#A29BAA" /><circle cx="85" cy="89" r="4" fill="#756E7C" /><circle cx="99" cy="89" r="4" fill="#756E7C" />
      <rect x="120" y="81" width="138" height="16" rx="8" fill="#514B59" />
      <rect x="63" y="128" width="86" height="25" rx="8" fill="#786897" />
      <rect x="63" y="164" width="86" height="25" rx="8" fill="#4D465C" />
      <rect x="63" y="200" width="86" height="25" rx="8" fill="#4D465C" />
      <rect x="63" y="236" width="86" height="25" rx="8" fill="#4D465C" />
      <rect x="184" y="131" width="142" height="11" rx="5.5" fill="#D6D0D9" />
      <rect x="184" y="151" width="204" height="6" rx="3" fill="#766F7D" />
      <rect x="184" y="177" width="96" height="105" rx="15" fill="url(#landing-tile)" />
      <rect x="289" y="177" width="96" height="105" rx="15" fill="#7256CF" />
      <rect x="394" y="177" width="96" height="105" rx="15" fill="#AD99EA" />
      <rect x="184" y="295" width="306" height="37" rx="13" fill="#45404C" />
      <rect x="184" y="345" width="215" height="8" rx="4" fill="#5D5664" />
      <rect x="184" y="360" width="273" height="8" rx="4" fill="#514B59" />
      <g transform="rotate(3 424 66)">
        <rect x="296" y="38" width="224" height="57" rx="19" fill="#413C49" stroke="#696270" />
        <circle cx="321" cy="66" r="12" fill="#BCAAF2" /><circle cx="339" cy="66" r="12" fill="#9574E3" /><circle cx="357" cy="66" r="12" fill="#5E42C8" />
        <rect x="382" y="61" width="111" height="10" rx="5" fill="#D2CAD9" />
      </g>
      <g transform="rotate(-3 125 357)">
        <rect x="25" y="330" width="217" height="60" rx="18" fill="#F6F4F1" />
        <rect x="39" y="342" width="36" height="36" rx="10" fill="#7556D4" />
        <path d="M49 361h16m-8-6v12" stroke="#F6F4F1" strokeWidth="2.5" strokeLinecap="round" />
        <rect x="87" y="347" width="113" height="9" rx="4.5" fill="#393342" />
        <rect x="87" y="364" width="83" height="6" rx="3" fill="#8E8991" />
      </g>
    </svg>
  );
}

export function ResourceArtwork() {
  return <svg viewBox="0 0 360 154" fill="none" aria-hidden="true" focusable="false">
    <rect x="65" y="37" width="120" height="142" rx="17" transform="rotate(-10 65 37)" fill="#A393DF" fillOpacity=".62" stroke="#C7B9F2" />
    <rect x="109" y="24" width="120" height="142" rx="17" transform="rotate(5 109 24)" fill="#8A75D1" fillOpacity=".8" stroke="#C7B9F2" />
    <rect x="128" y="43" width="57" height="7" rx="3.5" transform="rotate(5 128 43)" fill="#EEE9FE" />
    <rect x="126" y="63" width="86" height="6" rx="3" transform="rotate(5 126 63)" fill="#C7B9F2" />
    <rect x="124" y="79" width="65" height="6" rx="3" transform="rotate(5 124 79)" fill="#C7B9F2" />
    <rect x="289" y="110" width="42" height="20" rx="7" fill="#D0C1FA" fillOpacity=".38" />
  </svg>;
}

export function UpdateArtwork() {
  return <svg viewBox="0 0 360 154" fill="none" aria-hidden="true" focusable="false">
    <rect x="34" y="35" width="292" height="77" rx="19" fill="#A38CE5" fillOpacity=".68" stroke="#CBBBF4" />
    <rect x="52" y="53" width="37" height="37" rx="10" fill="#F7F5FF" />
    <path d="M62 72h17m-8.5-8v16" stroke="#7357CB" strokeWidth="2.5" strokeLinecap="round" />
    <rect x="102" y="57" width="115" height="8" rx="4" fill="#F2ECFF" />
    <rect x="102" y="74" width="77" height="6" rx="3" fill="#D5C7FA" />
    <rect x="57" y="114" width="252" height="75" rx="18" fill="#8067CA" fillOpacity=".52" stroke="#BDA7F1" />
  </svg>;
}

export function ParticipationArtwork() {
  return <svg viewBox="0 0 360 154" fill="none" aria-hidden="true" focusable="false">
    <rect x="38" y="29" width="189" height="55" rx="18" fill="#F7F4FF" />
    <rect x="55" y="45" width="153" height="8" rx="4" fill="#644AC5" />
    <rect x="55" y="61" width="95" height="6" rx="3" fill="#BDAAF3" />
    <rect x="184" y="89" width="142" height="53" rx="17" fill="#24202F" />
    <rect x="201" y="104" width="105" height="7" rx="3.5" fill="#C9C2D1" />
    <rect x="201" y="120" width="67" height="6" rx="3" fill="#777180" />
  </svg>;
}
