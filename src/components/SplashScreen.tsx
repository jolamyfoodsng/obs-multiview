/**
 * SplashScreen.tsx — Full-screen splash shown while the app loads resources
 *
 * Displays the introductory loading image with a subtle loading indicator.
 * Fades out once ready, then unmounts.
 */

import { useEffect, useState } from "react";

interface SplashScreenProps {
  /** When true, the splash begins its fade-out and will call onDone */
  ready: boolean;
  /** Called after the fade-out animation completes */
  onDone: () => void;
}

export default function SplashScreen({ ready, onDone }: SplashScreenProps) {
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!ready) return;

    // Start fade-out
    setFading(true);

    // Wait for CSS transition to finish, then unmount
    const timer = setTimeout(onDone, 600);
    return () => clearTimeout(timer);
  }, [ready, onDone]);

  return (
    <div className={`splash-screen${fading ? " splash-fade-out" : ""}`}>
      <img
        src="/obs_studio_introductory_image.png"
        alt="OBS Church Studio"
        className="splash-image"
        draggable={false}
      />
      {!ready && (
        <div className="splash-loader">
          <div className="splash-loader-bar" />
          <span className="splash-loader-text">Loading resources…</span>
        </div>
      )}
    </div>
  );
}
