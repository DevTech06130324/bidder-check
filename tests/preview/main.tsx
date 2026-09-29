import React from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "@/components/providers";
import { Shell } from "@/components/shell";
import { Dashboard } from "@/components/dashboard";
import { BidWorkspace } from "@/components/bids";
import { ResumeLibrary } from "@/components/resumes";
import { People } from "@/components/people";
import { Earnings } from "@/components/earnings";
import { Settings } from "@/components/settings";
import { fixture } from "./sample-data";
import "@/app/globals.css";
const pages: Record<string, React.ReactNode> = {
  "/dashboard": <Dashboard data={fixture} />,
  "/bids": <BidWorkspace data={fixture} />,
  "/resumes": <ResumeLibrary data={fixture} />,
  "/users": <People data={fixture} />,
  "/earnings": <Earnings data={fixture} />,
  "/settings": <Settings data={fixture} />,
};
createRoot(document.getElementById("root")!).render(
  <Providers>
    <Shell profile={fixture.profile} workspace="Northstar Studio">
      {pages[window.location.pathname] ?? pages["/dashboard"]}
    </Shell>
  </Providers>,
);
