import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { Routes, Route } from "react-router-dom";
import { fetchMe } from "./store/authSlice";
import Layout from "./components/Layout";
import RequireAuth from "./components/RequireAuth";
import Toasts from "./components/Toasts";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Sites from "./pages/Sites";
import Invite from "./pages/Invite";
import SiteLayout from "./pages/SiteLayout";
import Overview from "./pages/Overview";
import Funnels from "./pages/Funnels";
import Insights from "./pages/Insights";
import Settings from "./pages/Settings";
import Share from "./pages/Share";
import NotFound from "./pages/NotFound";

export default function App() {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(fetchMe());
  }, [dispatch]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth mode="login" />} />
        <Route path="/register" element={<Auth mode="register" />} />
        <Route path="/share/:token" element={<Share />} />
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/invite/:token" element={<Invite />} />
          <Route path="/sites" element={<Sites />} />
          <Route path="/sites/:siteId" element={<SiteLayout />}>
            <Route index element={<Overview />} />
            <Route path="funnels" element={<Funnels />} />
            <Route path="insights" element={<Insights />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toasts />
    </>
  );
}
