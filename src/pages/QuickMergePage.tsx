import { useNavigate } from "react-router-dom";
import { QuickMergePanel } from "../components/modules/QuickMergePanel";
import Icon from "../components/Icon";

export default function QuickMergePage() {
  const navigate = useNavigate();

  return (
    <div className="app-page quick-merge-page">
      <div className="app-page__inner quick-merge-page__inner">
        <header className="app-page__header quick-merge-page-header">
          <div className="quick-merge-page-head-left">
          <button
            type="button"
            className="quick-merge-page-back-btn"
            onClick={() => navigate("/hub?mode=live")}
          >
            <Icon name="arrow_back" size={20} />
            Service Hub
          </button>
          <div className="app-page__header-copy quick-merge-page-head-copy">
            <p className="app-page__eyebrow">Quick Merge</p>
            <h1 className="app-page__title">Build a multi-source composition and take it live in one step.</h1>
            <p className="app-page__subtitle">Combine sources quickly without leaving the production flow.</p>
          </div>
          </div>
        </header>

        <main className="quick-merge-page-main">
          <QuickMergePanel isActive />
        </main>
      </div>
    </div>
  );
}
