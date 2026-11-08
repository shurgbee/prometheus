"use client";

import { SWRConfig } from "swr";
import { ChatProvider } from "./chat/ChatContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        shouldRetryOnError: true,
        errorRetryCount: 3,
        dedupingInterval: 1500,
      }}
    >
      <ChatProvider>{children}</ChatProvider>
    </SWRConfig>
  );
}
