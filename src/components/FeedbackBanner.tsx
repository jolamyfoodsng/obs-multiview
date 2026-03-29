/**
 * FeedbackBanner — Displays health check warnings/errors.
 *
 * Non-intrusive banner at the top of ServiceMode that shows
 * actionable issues detected by feedbackService.
 */

import { useState, useEffect, useRef } from "react";
import { checkHealth, type FeedbackItem } from "../services/feedbackService";
import type { GenerationConfig } from "../services/layoutService";
import Icon from "./Icon";

interface Props {
    config: GenerationConfig | null;
    /** Re-check interval in ms (default 15000) */
    interval?: number;
}

export function FeedbackBanner({ config, interval = 15000 }: Props) {
    const [issues, setIssues] = useState<FeedbackItem[]>([]);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;

        const run = async () => {
            const result = await checkHealth(config);
            if (mountedRef.current) {
                setIssues(result);
            }
        };

        run();
        const timer = setInterval(run, interval);

        return () => {
            mountedRef.current = false;
            clearInterval(timer);
        };
    }, [config, interval]);

    const visible = issues.filter((i) => !dismissed.has(i.id));

    if (visible.length === 0) return null;

    return (
        <div className="feedback-banner">
            {visible.map((issue) => (
                <div
                    key={issue.id}
                    className={`feedback-item feedback-${issue.level}`}
                >
                    <Icon name={issue.icon} size={20} className="feedback-icon" />
                    <span className="feedback-msg">{issue.message}</span>
                    <button
                        className="feedback-dismiss"
                        onClick={() => setDismissed((prev) => new Set(prev).add(issue.id))}
                        title="Dismiss"
                    >
                        <Icon name="close" size={20} />
                    </button>
                </div>
            ))}
        </div>
    );
}
