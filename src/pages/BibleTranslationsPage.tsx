import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BibleLibrary from "../bible/components/BibleLibrary";

export default function BibleTranslationsPage() {
  const navigate = useNavigate();

  const handleClose = useCallback(() => {
    navigate("/settings");
  }, [navigate]);

  return (
    <div className="production-page">
      <BibleLibrary
        open
        onClose={handleClose}
        mode="page"
        closeOnUse={false}
      />
    </div>
  );
}
