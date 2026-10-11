import { useEffect, useRef, useState } from "react";
import { SESSION_EXPIRED, setToken, type ClientView } from "./lib/api";
import { parseDeviceLink } from "./lib/devices";
import { loadProfile, type Profile } from "./lib/profile";
import { AddDevice } from "./screens/AddDevice";
import { Create } from "./screens/Create";
import { Home } from "./screens/Home";
import { Receive } from "./screens/Receive";
import { Recover } from "./screens/Recover";
import { Send } from "./screens/Send";
import { Settings } from "./screens/Settings";
import { Unlock } from "./screens/Unlock";
import { Welcome } from "./screens/Welcome";
import { TabBar, type Tab } from "./ui";

type Route = "welcome" | "create" | "recover" | "join" | "unlock" | "home" | "send" | "receive" | "settings";
const WALLET_ROUTES: Route[] = ["home", "send", "receive", "settings"];

export function App() {
  const [profile, setProfile] = useState<Profile | null>(loadProfile());
  const [client, setClient] = useState<ClientView | null>(null);
  // An "Add a device" link (#add-device=…) from the client's other device.
  const [deviceLink, setDeviceLink] = useState(() => parseDeviceLink(location.hash));
  const [route, setRoute] = useState<Route>(deviceLink && !profile ? "join" : profile ? "unlock" : "welcome");
  const [notice, setNotice] = useState<string | null>(null);

  // When the bank session times out while the wallet is open, lock and ask to unlock again
  // instead of failing every request silently.
  const routeRef = useRef(route);
  useEffect(() => {
    routeRef.current = route;
    window.scrollTo(0, 0);
  }, [route]);

  // The link can also be pasted into a tab that already shows the app (only the hash changes).
  useEffect(() => {
    const onHash = () => {
      const link = parseDeviceLink(location.hash);
      if (!link || loadProfile()) return;
      setDeviceLink(link);
      setRoute("join");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onExpired = () => {
      if (!WALLET_ROUTES.includes(routeRef.current)) return;
      setClient(null);
      setNotice("Your Swissquote session expired. Unlock again to continue.");
      setRoute("unlock");
    };
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  const enter = (p: Profile) => {
    setProfile(p);
    setToken(null);
    setNotice(null);
    setRoute("unlock");
  };

  let view;
  switch (route) {
    case "welcome":
      view = <Welcome onCreate={() => setRoute("create")} onRecover={() => setRoute("recover")} />;
      break;
    case "create":
      view = <Create onBack={() => setRoute("welcome")} onFinished={enter} />;
      break;
    case "join":
      view = deviceLink && (
        <AddDevice
          link={deviceLink}
          onBack={() => {
            history.replaceState(null, "", location.pathname);
            setRoute(profile ? "unlock" : "welcome");
          }}
          onFinished={enter}
        />
      );
      break;
    case "recover":
      view = <Recover onBack={() => setRoute(profile ? "unlock" : "welcome")} onFinished={enter} />;
      break;
    case "unlock":
      view = profile && (
        <Unlock
          profile={profile}
          notice={notice}
          onUnlocked={(c) => {
            setClient(c);
            setNotice(null);
            setRoute("home");
          }}
          onRecover={() => setRoute("recover")}
        />
      );
      break;
    case "home":
      view = profile && <Home profile={profile} client={client} go={setRoute} />;
      break;
    case "send":
      view = profile && <Send profile={profile} client={client} onBack={() => setRoute("home")} />;
      break;
    case "receive":
      view = profile && <Receive profile={profile} onBack={() => setRoute("home")} />;
      break;
    case "settings":
      view = profile && (
        <Settings
          profile={profile}
          client={client}
          onBack={() => setRoute("home")}
          onLock={() => {
            setToken(null);
            setClient(null);
            setRoute("unlock");
          }}
          onWiped={() => {
            setProfile(null);
            setClient(null);
            setRoute("welcome");
          }}
        />
      );
      break;
  }
  const tabs = WALLET_ROUTES.includes(route) && profile;
  return (
    <div className={`app ${tabs ? "with-tabs" : ""}`}>
      {view}
      {tabs && <TabBar active={route as Tab} go={setRoute} />}
    </div>
  );
}
