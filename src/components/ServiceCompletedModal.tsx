/**
 * ServiceCompletedModal.tsx — End-of-service summary
 *
 * Shows service stats (duration, bible verses, songs played)
 * with options to start a new service or return to dashboard.
 */

import { useCallback } from "react";
import Icon from "./Icon";

interface ServiceCompletedModalProps {
  open: boolean;
  duration: string;
  bibleVerses: number;
  songsPlayed: number;
  lowerThirds: number;
  onStartNew: () => void;
  onDashboard: () => void;
}

export function ServiceCompletedModal({
  open,
  duration,
  bibleVerses,
  songsPlayed,
  lowerThirds,
  onStartNew,
  onDashboard,
}: ServiceCompletedModalProps) {
  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onDashboard();
    },
    [onDashboard]
  );

  if (!open) return null;

  return (
    <div className="sc-backdrop" onClick={handleBackdrop}>
      <div className="sc-modal">
        {/* Header */}
        <div className="sc-header">
          <div className="sc-check-wrap">
            <Icon name="check_circle" size={20} />
          </div>
          <h1 className="sc-title">Service Completed</h1>
          <p className="sc-subtitle">
            Great job! Here is a summary of today's service.
          </p>
        </div>

        {/* Stats */}
        <div className="sc-stats">
          <div className="sc-stats-card">
            <div className="sc-stat-row">
              <div className="sc-stat-left">
                <div className="sc-stat-icon">
                  <Icon name="schedule" size={20} />
                </div>
                <span className="sc-stat-label">Total Duration</span>
              </div>
              <span className="sc-stat-value">{duration}</span>
            </div>

            <div className="sc-stat-row">
              <div className="sc-stat-left">
                <div className="sc-stat-icon">
                  <Icon name="menu_book" size={20} />
                </div>
                <span className="sc-stat-label">Bible Verses Displayed</span>
              </div>
              <span className="sc-stat-value">{bibleVerses}</span>
            </div>

            <div className="sc-stat-row">
              <div className="sc-stat-left">
                <div className="sc-stat-icon">
                  <Icon name="library_music" size={20} />
                </div>
                <span className="sc-stat-label">Songs Used</span>
              </div>
              <span className="sc-stat-value">{songsPlayed}</span>
            </div>

            {lowerThirds > 0 && (
              <div className="sc-stat-row">
                <div className="sc-stat-left">
                  <div className="sc-stat-icon">
                    <Icon name="subtitles" size={20} />
                  </div>
                  <span className="sc-stat-label">Lower Thirds Shown</span>
                </div>
                <span className="sc-stat-value">{lowerThirds}</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="sc-actions">
          <button className="sc-btn-new" onClick={onStartNew}>
            <Icon name="add_circle" size={20} />
            Start New Service
          </button>
          <button className="sc-btn-dashboard" onClick={onDashboard}>
            Return to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}

export default ServiceCompletedModal;
