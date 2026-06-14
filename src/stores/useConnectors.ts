import { create } from 'zustand';

interface ConnectorConfig {
  enabled: boolean;
  config: Record<string, string>;
  last_status?: string | null;
  account_label?: string | null;
}

interface ConnectorsState {
  connectors: Record<string, ConnectorConfig>;
  activeCount: number;
  agentId: string | null;
  setAgentId: (id: string) => void;
  loadConnectors: (agentId: string) => Promise<void>;
  toggle: (key: string) => void;
  setConfig: (key: string, config: Record<string, string>) => Promise<void>;
  initiateConnection: (key: string) => Promise<void>;
  fetchStatus: () => Promise<void>;
}

export const useConnectors = create<ConnectorsState>((set, get) => ({
  connectors: {
    google_calendar: { enabled: false, config: {} },
    telegram: { enabled: false, config: {} },
    shopify_catalog: { enabled: false, config: {} },
    hubspot_crm: { enabled: false, config: {} }
  },
  activeCount: 0,
  agentId: null,

  setAgentId: (id) => set({ agentId: id }),

  loadConnectors: async (agentId) => {
    try {
      const res = await fetch(`http://localhost:8000/api/agent/${agentId}/connectors/status`);
      if (res.ok) {
        const data = await res.json();
        const newConnectors = { ...get().connectors };
        let count = 0;
        
        for (const c of data) {
          newConnectors[c.connector_key] = {
            enabled: c.connected,
            config: c.config_masked || {},
            last_status: c.last_status,
            account_label: c.account_label
          };
          if (c.connected) count++;
        }
        
        set({ connectors: newConnectors, activeCount: count, agentId });
      }
    } catch (e) {
      console.error("Failed to load connectors:", e);
    }
  },

  toggle: async (key) => {
    const { connectors, agentId } = get();
    const isCurrentlyEnabled = connectors[key]?.enabled || false;
    const newEnabled = !isCurrentlyEnabled;
    const config = connectors[key]?.config || {};
    
    // Always update local state immediately
    set((state) => {
      const newCount = newEnabled ? state.activeCount + 1 : Math.max(0, state.activeCount - 1);
      return {
        connectors: {
          ...state.connectors,
          [key]: { ...state.connectors[key], enabled: newEnabled }
        },
        activeCount: newCount
      };
    });
    
    // Sync to backend if agentId is available and it's a custom connector
    if (key.startsWith('custom_') && agentId) {
      try {
        await fetch(`http://localhost:8000/api/agent/${agentId}/connectors/custom`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connector: key, enabled: newEnabled, config })
        });
      } catch (e) {
        console.error("Failed to toggle custom connector:", e);
      }
    }
  },

  initiateConnection: async (key) => {
    const { agentId } = get();
    
    // Always toggle ON locally first so the UI responds immediately
    set((state) => ({
      connectors: {
        ...state.connectors,
        [key]: { ...state.connectors[key], enabled: true, last_status: 'pending' }
      },
      activeCount: state.activeCount + 1,
    }));
    
    // If we have an agentId, try the real OAuth flow
    if (!agentId) {
      console.log(`Connector ${key} toggled ON locally (no agent yet — will sync later)`);
      return;
    }
    
    try {
      const res = await fetch(`http://localhost:8000/api/agent/${agentId}/connectors/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connector: key })
      });
      
      if (res.ok) {
        const data = await res.json();
        if (data.auth_url) {
          const popup = window.open(data.auth_url, "Connect", "width=600,height=700");
          
          // Poll for status aggressively while window is assumed open
          const pollInterval = setInterval(async () => {
             await get().fetchStatus();
             const currentStatus = get().connectors[key]?.enabled;
             if (currentStatus) {
               clearInterval(pollInterval);
               if (popup && !popup.closed) popup.close();
             }
          }, 2000);
          
          // Clear interval after 5 mins max
          setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
        }
      }
    } catch (e) {
      console.error("Failed to initiate connection:", e);
    }
  },

  setConfig: async (key, config) => {
    const { agentId } = get();
    
    set((state) => ({
      connectors: {
        ...state.connectors,
        [key]: { ...state.connectors[key], config }
      }
    }));

    if (agentId && key.startsWith('custom_')) {
      try {
        await fetch(`http://localhost:8000/api/agent/${agentId}/connectors/custom`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connector: key, enabled: true, config })
        });
      } catch (e) {
        console.error("Failed to save custom connector config:", e);
      }
    }
  },

  fetchStatus: async () => {
    const { agentId } = get();
    if (!agentId) return;
    
    try {
      const res = await fetch(`http://localhost:8000/api/agent/${agentId}/connectors/status`);
      if (res.ok) {
        const data = await res.json();
        set((state) => {
          const newConnectors = { ...state.connectors };
          let count = 0;
          for (const c of data) {
            if (newConnectors[c.connector_key]) {
              newConnectors[c.connector_key].enabled = c.connected;
              newConnectors[c.connector_key].last_status = c.last_status;
              newConnectors[c.connector_key].account_label = c.account_label;
            } else if (c.connector_key.startsWith('custom_')) {
              newConnectors[c.connector_key] = {
                enabled: c.connected,
                config: {},
                last_status: c.last_status,
                account_label: c.account_label
              };
            }
            if (c.connected) count++;
          }
          return { connectors: newConnectors, activeCount: count };
        });
      }
    } catch (e) {
      console.error("Failed to fetch connector status:", e);
    }
  }
}));
