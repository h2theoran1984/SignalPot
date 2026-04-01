"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface LobsterDrop {
  leftPct: number;
  delaySec: number;
  durationSec: number;
}

export default function LobsterRainTrigger() {
  const [lobsterRain, setLobsterRain] = useState(false);
  const [drops, setDrops] = useState<LobsterDrop[]>([]);
  const bufferRef = useRef("");

  const triggerLobsterRain = useCallback(() => {
    setDrops(
      Array.from({ length: 20 }, () => ({
        leftPct: Math.random() * 95,
        delaySec: Math.random() * 1.5,
        durationSec: 2 + Math.random() * 1.5,
      }))
    );
    setLobsterRain((active) => {
      if (active) return active;
      return true;
    });
    setTimeout(() => setLobsterRain(false), 3500);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      bufferRef.current += e.key.toLowerCase();
      if (bufferRef.current.length > 20) bufferRef.current = bufferRef.current.slice(-20);
      if (bufferRef.current.includes("lobster")) {
        bufferRef.current = "";
        triggerLobsterRain();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [triggerLobsterRain]);

  if (!lobsterRain) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden" aria-hidden="true">
      {drops.map((drop, i) => (
        <span
          key={i}
          className="absolute text-2xl animate-lobster-fall"
          style={{
            left: `${drop.leftPct}%`,
            animationDelay: `${drop.delaySec}s`,
            animationDuration: `${drop.durationSec}s`,
          }}
        >
          {"\uD83E\uDD9E"}
        </span>
      ))}
    </div>
  );
}
