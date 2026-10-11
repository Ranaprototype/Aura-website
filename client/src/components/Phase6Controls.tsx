import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Hand,
  Maximize2,
  Mic,
  Music2,
  Settings2,
  Share2,
  Sparkles,
  X,
} from "lucide-react";

type Part = string;
type Config = Record<string, string>;
const COLORS: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  black: "#0b1220",
  white: "#f4f4f5",
  cyan: "#00eaff",
  violet: "#8b5cf6",
  purple: "#a855f7",
  pink: "#ec4899",
  gold: "#fbbf24",
  orange: "#f97316",
  yellow: "#facc15",
  silver: "#cbd5e1",
  brown: "#92400e",
  beige: "#d6b98c",
};
const NUM: Record<string, string> = {
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};
const parts = ["upper", "sole", "laces", "heel", "tongue"];
function vibrate(pattern: number | number[]) {
  if (typeof navigator != "undefined" && "vibrate" in navigator)
    try {
      navigator.vibrate(pattern);
    } catch {}
}
export default function Phase6Controls({
  config,
  mutate,
  part,
  setPart,
  onExplode,
  onXray,
  onReset,
  onRandomize,
  onAdd,
  onRotate,
  onZoom,
}: {
  config: Config;
  mutate: (c: Config) => void;
  part: Part;
  setPart: (p: any) => void;
  onExplode: () => void;
  onXray: () => void;
  onReset: () => void;
  onRandomize: () => void;
  onAdd: () => void;
  onRotate: (d: number) => void;
  onZoom: (d: number) => void;
}) {
  const [voice, setVoice] = useState(false);
  const [supported, setSupported] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [logs, setLogs] = useState<Array<{ text: string; ok: boolean }>>([]);
  const [lang, setLang] = useState("en-US");
  const [continuous, setContinuous] = useState(false);
  const rec = useRef<any>(null);
  const [gesture, setGesture] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [gestureLabel, setGestureLabel] = useState("—");
  const [modal, setModal] = useState<
    "ar" | "share" | "help" | "hotspot" | null
  >(null);
  const [film, setFilm] = useState(false);
  const [filmProgress, setFilmProgress] = useState(0);
  const [sound, setSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const [hotspots, setHotspots] = useState(true);
  const [hotspotIndex, setHotspotIndex] = useState(0);
  const hotspotData = useMemo(
    () => [
      {
        title: "Carbon-rubber outsole",
        copy: "Engineered for 10,000 miles of responsive traction and quiet landings.",
      },
      {
        title: "Reinforced heel counter",
        copy: "A stabilizing TPU frame supports every change of direction.",
      },
      {
        title: "Adaptive mesh upper",
        copy: "Breathable structure flexes with the foot while holding its shape.",
      },
    ],
    []
  );
  useEffect(() => {
    const w = window as any;
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      rec.current?.stop();
      stream.current?.getTracks().forEach(t => t.stop());
    };
  }, []);
  const say = (text: string) => {
    setTranscript(text);
    let ok = false;
    const s = text.toLowerCase();
    const color = Object.keys(COLORS).find(c => s.includes(c));
    const named = parts.find(p => s.includes(p));
    const target = named || part;
    if (
      color &&
      (s.includes("color") || s.includes("make") || s.includes(" to "))
    ) {
      mutate({ ...config, [target]: COLORS[color] });
      ok = true;
      vibrate([10, 10]);
    } else {
      const mat = [
        "leather",
        "mesh",
        "suede",
        "rubber",
        "foam",
        "flat",
        "round",
      ].find(m => s.includes(m));
      if (mat) {
        mutate({ ...config, [`${target}Mat`]: mat });
        ok = true;
      }
    }
    if (s.includes("size")) {
      const n =
        Object.entries(NUM).find(([k]) => s.includes(k))?.[1] ||
        s.match(/\b([6-9]|1[0-2])\b/)?.[1];
      if (n) {
        mutate({ ...config, size: n });
        ok = true;
      }
    }
    if (s.includes("rotate left")) {
      onRotate(-1);
      ok = true;
    }
    if (s.includes("rotate right")) {
      onRotate(1);
      ok = true;
    }
    if (s.includes("zoom in")) {
      onZoom(1);
      ok = true;
    }
    if (s.includes("zoom out")) {
      onZoom(-1);
      ok = true;
    }
    if (s.includes("explode")) {
      onExplode();
      ok = true;
    }
    if (s.includes("assemble")) {
      onExplode();
      ok = true;
    }
    if (s.includes("x-ray on")) {
      onXray();
      ok = true;
    }
    if (s.includes("x-ray off")) {
      onXray();
      ok = true;
    }
    if (s.includes("reset")) {
      onReset();
      ok = true;
    }
    if (s.includes("randomize")) {
      onRandomize();
      ok = true;
    }
    if (s.includes("show me the")) {
      const p = parts.find(x => s.includes(x));
      if (p) setPart(p);
      ok = !!p;
    }
    if (s.includes("add to cart")) {
      onAdd();
      ok = true;
    }
    if (s.includes("go back")) {
      history.back();
      ok = true;
    }
    setLogs(l => [{ text, ok }, ...l].slice(0, 5));
    vibrate(ok ? [10, 10] : 30);
    return ok;
  };
  const startVoice = () => {
    setVoice(true);
    const C =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!C) {
      setLogs(l =>
        [
          {
            text: "Speech recognition is not supported on this device",
            ok: false,
          },
          ...l,
        ].slice(0, 5)
      );
      return;
    }
    const r = new C();
    rec.current = r;
    r.lang = lang;
    r.continuous = continuous;
    r.interimResults = true;
    r.onresult = (e: any) => {
      const last = e.results[e.results.length - 1];
      const text = last[0].transcript;
      setTranscript(text);
      if (last.isFinal) say(text);
    };
    r.onend = () => {
      if (voice && continuous)
        try {
          r.start();
        } catch {}
    };
    r.onerror = () =>
      setLogs(l =>
        [
          {
            text: "Voice input unavailable — check microphone permission",
            ok: false,
          },
          ...l,
        ].slice(0, 5)
      );
    try {
      r.start();
    } catch {
      setLogs(l =>
        [{ text: "Voice input could not start", ok: false }, ...l].slice(0, 5)
      );
    }
  };
  const stopVoice = () => {
    rec.current?.stop();
    setVoice(false);
  };
  const toggleGesture = async () => {
    if (gesture) {
      stream.current?.getTracks().forEach(t => t.stop());
      setGesture(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.current = s;
      if (video.current) video.current.srcObject = s;
      setGesture(true);
      setGestureLabel("PALM");
    } catch {
      setGestureLabel("CAMERA ACCESS REQUIRED");
    }
  };
  const openAr = () => setModal("ar");
  const playTone = () => {
    if (!sound || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    audio.current ||= new AudioContext();
    const o = audio.current.createOscillator();
    const g = audio.current.createGain();
    o.frequency.value = 520;
    g.gain.value = 0.04;
    o.connect(g);
    g.connect(audio.current.destination);
    o.start();
    o.stop(audio.current.currentTime + 0.18);
  };
  useEffect(() => {
    if (sound) playTone();
  }, [config]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "?") {
        e.preventDefault();
        setModal("help");
      }
      if (e.key === "h") setHotspotIndex(i => (i + 1) % hotspotData.length);
      if (e.key === "Escape") {
        setModal(null);
        setFilm(false);
        stopVoice();
      }
      if (e.key === "/") {
        const el = document.querySelector("input");
        if (el) (el as HTMLElement).focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!film) return;
    const start = performance.now();
    let id = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 30000);
      setFilmProgress(p);
      if (p < 1) id = requestAnimationFrame(tick);
      else setFilm(false);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [film]);
  const share = () => {
    const text = `HOLO Aether Runner — ${window.location.href}`;
    navigator.clipboard?.writeText(text);
    setModal("share");
  };
  return (
    <>
      <div className="phase6-hud">
        <button onClick={openAr} aria-label="Open AR preview">
          <Maximize2 size={15} /> AR
        </button>
        {supported && (
          <button
            onClick={voice ? stopVoice : startVoice}
            className={voice ? "phase6-active" : ""}
            aria-label="Voice control"
          >
            <Mic size={15} /> Voice
          </button>
        )}
        <button
          onClick={toggleGesture}
          className={gesture ? "phase6-active" : ""}
          aria-label="Gesture control"
        >
          <Hand size={15} /> Gesture
        </button>
        <button
          onClick={() => setHotspots(v => !v)}
          className={hotspots ? "phase6-active" : ""}
          aria-label="Toggle hotspots"
        >
          <Sparkles size={15} /> Hotspots
        </button>
        <button
          onClick={() => {
            setFilm(true);
            setFilmProgress(0);
          }}
          aria-label="Play cinematic film"
        >
          Play Film
        </button>
        <button onClick={share} aria-label="Share the moment">
          <Share2 size={15} /> Share
        </button>
        <button
          onClick={() => setSound(v => !v)}
          className={sound ? "phase6-active" : ""}
          aria-label="Toggle ambient sound"
        >
          <Music2 size={15} /> Sound
        </button>
        <button
          onClick={() => setModal("help")}
          aria-label="Keyboard shortcuts"
        >
          <CircleHelp size={15} />
        </button>
      </div>
      {hotspots && (
        <div className="product-hotspots" aria-label="Product hotspots">
          <button
            style={{ left: "27%", top: "52%" }}
            onClick={() => {
              setHotspotIndex(0);
              setModal("hotspot");
            }}
            aria-label="Carbon rubber outsole hotspot"
          />
          <button
            style={{ left: "67%", top: "44%" }}
            onClick={() => {
              setHotspotIndex(1);
              setModal("hotspot");
            }}
            aria-label="Heel counter hotspot"
          />
          <button
            style={{ left: "48%", top: "32%" }}
            onClick={() => {
              setHotspotIndex(2);
              setModal("hotspot");
            }}
            aria-label="Adaptive mesh hotspot"
          />
        </div>
      )}
      {voice && (
        <section
          className="voice-panel"
          role="dialog"
          aria-label="Voice control"
        >
          <button onClick={stopVoice} aria-label="Stop voice control">
            <X size={14} />
          </button>
          <span className="mono-label">
            <i /> LISTENING…
          </span>
          <strong>{transcript || "Say a command"}</strong>
          <div className="voice-log">
            {logs.map((l, i) => (
              <div key={i}>
                <span className={l.ok ? "ok" : "bad"}>
                  {l.ok ? "EXECUTED" : "NOT RECOGNIZED"}
                </span>{" "}
                {l.text}
              </div>
            ))}
          </div>
          <small>try: “make the upper blue” · “size ten” · “explode”</small>
          <details>
            <summary>
              <Settings2 size={13} /> Voice settings
            </summary>
            <label>
              Language
              <select value={lang} onChange={e => setLang(e.target.value)}>
                <option value="en-US">English</option>
                <option value="es-ES">Español</option>
                <option value="fr-FR">Français</option>
                <option value="de-DE">Deutsch</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={continuous}
                onChange={e => setContinuous(e.target.checked)}
              />{" "}
              Continuous listening
            </label>
          </details>
        </section>
      )}
      {gesture && (
        <section className="gesture-pip">
          <button onClick={toggleGesture} aria-label="Stop gestures">
            <X size={13} />
          </button>
          <video ref={video} autoPlay muted playsInline />
          <strong>{gestureLabel}</strong>
          <small>Processed locally. Nothing leaves your device.</small>
        </section>
      )}
      {film && (
        <div className="film-mode">
          <button onClick={() => setFilm(false)} className="film-skip">
            Skip film <X size={15} />
          </button>
          <div className="film-caption">AERO RUNNER / CINEMATIC STUDY</div>
          <div className="film-progress">
            <span style={{ width: `${filmProgress * 100}%` }} />
          </div>
        </div>
      )}
      {modal && (
        <div className="phase6-modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="phase6-modal"
            role="dialog"
            aria-modal="true"
            onClick={e => e.stopPropagation()}
          >
            <button
              className="phase6-close"
              onClick={() => setModal(null)}
              aria-label="Close"
            >
              <X size={17} />
            </button>
            {modal === "ar" && (
              <>
                <span className="mono-label">HOLO / AR PREVIEW</span>
                <h2>
                  Take it <em>outside.</em>
                </h2>
                <p>
                  On mobile, use your camera to place this configured Aether
                  Runner in your space. On desktop, scan the QR code with your
                  phone.
                </p>
                <img
                  className="qr"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(window.location.href)}`}
                  alt="QR code for mobile AR preview"
                />
                <button
                  className="button button--primary"
                  onClick={() => {
                    setModal(null);
                    setToastGlobal("AR preview ready on mobile");
                  }}
                >
                  Open mobile handoff
                </button>
              </>
            )}
            {modal === "share" && (
              <>
                <span className="mono-label">HOLO / SHARE THE MOMENT</span>
                <h2>
                  Make it <em>yours.</em>
                </h2>
                <div className="share-preview">
                  <div
                    className="share-object"
                    style={{ background: config.upper }}
                  />
                  <span>MADE WITH HOLO</span>
                </div>
                <div className="share-actions">
                  <button onClick={() => downloadCard(config)}>
                    Download PNG
                  </button>
                  <button onClick={() => downloadCard(config, "square")}>
                    Instagram square
                  </button>
                  <button onClick={() => downloadCard(config, "story")}>
                    Story format
                  </button>
                  <button
                    onClick={() =>
                      navigator.clipboard?.writeText(window.location.href)
                    }
                  >
                    Copy configuration link
                  </button>
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent("My HOLO build")}&url=${encodeURIComponent(window.location.href)}`}
                  >
                    Share to X
                  </a>
                </div>
              </>
            )}
            {modal === "hotspot" && (
              <>
                <span className="mono-label">DETAIL / 0{hotspotIndex + 1}</span>
                <h2>{hotspotData[hotspotIndex].title}</h2>
                <p>{hotspotData[hotspotIndex].copy}</p>
                <div className="popover-nav">
                  <button
                    onClick={() =>
                      setHotspotIndex(
                        i => (i + hotspotData.length - 1) % hotspotData.length
                      )
                    }
                  >
                    <ChevronLeft />
                  </button>
                  <span>
                    {hotspotIndex + 1} / {hotspotData.length}
                  </span>
                  <button
                    onClick={() =>
                      setHotspotIndex(i => (i + 1) % hotspotData.length)
                    }
                  >
                    <ChevronRight />
                  </button>
                </div>
              </>
            )}
            {modal === "help" && (
              <>
                <span className="mono-label">KEYBOARD / CONTROL MAP</span>
                <h2>
                  Move through <em>light.</em>
                </h2>
                <div className="shortcut-list">
                  <div>
                    <kbd>?</kbd> Shortcuts
                  </div>
                  <div>
                    <kbd>H</kbd> Cycle hotspots
                  </div>
                  <div>
                    <kbd>R</kbd> Reset build
                  </div>
                  <div>
                    <kbd>E</kbd> Explode parts
                  </div>
                  <div>
                    <kbd>X</kbd> X-ray view
                  </div>
                  <div>
                    <kbd>Esc</kbd> Close overlay
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
let setToastGlobal = (s: string) => {
  window.dispatchEvent(new CustomEvent("holo-toast", { detail: s }));
};
function downloadCard(config: Config, mode = "wide") {
  const c = document.createElement("canvas");
  c.width = mode === "square" ? 1080 : mode === "story" ? 1080 : 1400;
  c.height = mode === "square" ? 1080 : mode === "story" ? 1920 : 900;
  const x = c.getContext("2d")!;
  x.fillStyle = "#f7f5ff";
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = config.upper || "#8b5cf6";
  x.shadowColor = x.fillStyle;
  x.shadowBlur = 70;
  x.beginPath();
  x.ellipse(
    c.width / 2,
    c.height / 2,
    c.width * 0.24,
    c.height * 0.1,
    0,
    0,
    Math.PI * 2
  );
  x.fill();
  x.shadowBlur = 0;
  x.fillStyle = "#292947";
  x.font = "22px monospace";
  x.fillText("MADE WITH HOLO", 40, c.height - 50);
  const a = document.createElement("a");
  a.download = `holo-${mode}.png`;
  a.href = c.toDataURL("image/png");
  a.click();
}
