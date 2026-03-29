import { useNavigate } from "react-router-dom";
import { QuickMergePanel } from "../components/modules/QuickMergePanel";
import Icon from "../components/Icon";

export default function QuickMergePage() {
  const navigate = useNavigate();

  return (
    <div className="quick-merge-page">
      <header className="quick-merge-page-header">
        <div className="quick-merge-page-head-left">
          <button
            type="button"
            className="quick-merge-page-back-btn"
            onClick={() => navigate("/hub?mode=live")}
          >
            <Icon name="arrow_back" size={20} />
            Service Hub
          </button>
          <div className="quick-merge-page-head-copy">
            <h1>Quick Merge</h1>
            <p>Build a multi-source composition and take it live in one step.</p>
          </div>
        </div>
      </header>

      <main className="quick-merge-page-main">
        <QuickMergePanel isActive />
      </main>
    </div>
  );
}

