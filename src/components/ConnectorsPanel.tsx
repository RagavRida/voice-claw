import React, { useState, useEffect } from 'react';
import { Sliders, Calendar, Send, ShoppingBag, Database, Plus, Check, Zap, MessageCircle } from 'lucide-react';
import { useConnectors } from '../stores/useConnectors';

export function ConnectorsPanel() {
  const { connectors, activeCount, toggle, setConfig, initiateConnection, fetchStatus } = useConnectors();
  
  // Custom Integration Modal State
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customWebhookUrl, setCustomWebhookUrl] = useState("");
  const [customMethod, setCustomMethod] = useState("POST");
  const [customTrigger, setCustomTrigger] = useState("Always include in context");
  
  // Polling for status
  useEffect(() => {
    const interval = setInterval(() => {
      fetchStatus();
    }, 30000); // 30 seconds
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleToggleCustom = (key: string) => {
    toggle(key);
  };

  const handleSaveCustom = async () => {
    if (!customName || !customWebhookUrl) return;
    const key = `custom_${customName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
    await setConfig(key, {
      name: customName,
      webhook_url: customWebhookUrl,
      method: customMethod,
      trigger: customTrigger,
      headers: "" // simplified for now
    });
    setShowCustomModal(false);
    setCustomName("");
    setCustomWebhookUrl("");
  };

  const getStatusColor = (enabled: boolean, lastStatus?: string | null) => {
    if (!enabled) return 'bg-slate-300';
    if (lastStatus === 'failed') return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]';
    if (lastStatus === 'pending') return 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.5)]';
    return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]'; // success / connected
  };

  // Extract all connectors including custom ones
  const allConnectorKeys = Object.keys(connectors);
  const customConnectors = allConnectorKeys.filter(k => k.startsWith('custom_'));
  const totalConnectors = 4 + customConnectors.length;

  const renderConnectorRow = (
    key: string, 
    icon: React.ReactNode, 
    title: string, 
    subtitle: string,
    isCustom: boolean = false
  ) => {
    const isConnected = connectors[key]?.enabled || false;
    const lastStatus = connectors[key]?.last_status;
    const accountLabel = connectors[key]?.account_label;
    
    const handleToggle = async () => {
      if (isCustom) {
        // Custom connectors just toggle locally
        handleToggleCustom(key);
      } else if (!isConnected) {
        // Built-in: toggling ON → start OAuth flow
        await initiateConnection(key);
      } else {
        // Built-in: toggling OFF → disconnect
        toggle(key);
      }
    };
    
    return (
      <div className={`rounded-xl border transition-all duration-300 overflow-hidden ${isConnected ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
        <div className="flex items-center justify-between px-4 py-3.5 relative z-10 bg-inherit">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isConnected ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
              {icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-slate-800">{title}</p>
                {isConnected && <Check className="w-3.5 h-3.5 text-emerald-500" />}
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`w-2 h-2 rounded-full transition-colors ${getStatusColor(isConnected, lastStatus)}`} title={lastStatus || (isConnected ? 'Connected' : 'Disabled')} />
            <button
              onClick={handleToggle}
              className={`relative w-10 h-[22px] rounded-full transition-colors duration-300 cursor-pointer ${isConnected ? 'bg-emerald-500' : 'bg-slate-300'}`}
              title={isConnected ? `Disconnect ${title}` : `Connect ${title}`}
            >
              <span className={`absolute top-[3px] left-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-spring ${isConnected ? 'translate-x-[18px]' : ''}`} />
            </button>
          </div>
        </div>
        
        {/* Account Label Drawer */}
        <div 
          className="transition-all duration-300 ease-in-out" 
          style={{ 
            maxHeight: isConnected && accountLabel ? '50px' : '0', 
            opacity: isConnected && accountLabel ? 1 : 0,
            visibility: isConnected && accountLabel ? 'visible' : 'hidden'
          }}
        >
          <div className="px-4 pb-3 pt-1 border-t border-emerald-100 bg-white/50 text-[11px] font-medium text-emerald-700">
            Connected: {accountLabel}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div id="connectors-panel" className="hidden md:flex md:col-span-4 bg-white border border-slate-200 rounded-2xl shadow-sm flex-col h-[680px] overflow-hidden relative">
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 px-6 py-4 shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center shrink-0">
            <Sliders className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight">Connectors & Tools</h3>
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">Integrate your business stack</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 pb-24">
        {renderConnectorRow(
          'google_calendar', 
          <Calendar className="w-4.5 h-4.5" />, 
          'Google Calendar', 
          'Appointment booking & scheduling'
        )}

        {renderConnectorRow(
          'telegram', 
          <MessageCircle className="w-4.5 h-4.5" />, 
          'Telegram', 
          'Send Telegram messages & notifications'
        )}

        {renderConnectorRow(
          'shopify_catalog', 
          <ShoppingBag className="w-4.5 h-4.5" />, 
          'Shopify / Catalog', 
          'Live inventory & products'
        )}

        {renderConnectorRow(
          'hubspot_crm', 
          <Database className="w-4.5 h-4.5" />, 
          'HubSpot / CRM', 
          'Lead capture & customer data'
        )}

        {customConnectors.map(key => {
          const config = connectors[key].config as any;
          return renderConnectorRow(
            key,
            <Zap className="w-4.5 h-4.5" />,
            config.name || key,
            'Custom Webhook',
            true
          )
        })}

        <button 
          onClick={() => setShowCustomModal(true)}
          className="w-full py-3 mt-4 border border-dashed border-slate-300 rounded-xl text-[13px] font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Add Custom Integration
        </button>
      </div>

      {/* Footer Counter */}
      <div className="absolute bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur border-t border-slate-100 flex items-center justify-between z-10">
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Active connectors</p>
        <div className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-300 ${activeCount === totalConnectors ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>
          <span className="animate-pulse-once">{activeCount}</span> / {totalConnectors}
        </div>
      </div>

      {/* Custom Integration Modal Slider */}
      <div 
        className="absolute inset-0 bg-white z-20 transition-transform duration-300 ease-spring"
        style={{ transform: showCustomModal ? 'translateY(0)' : 'translateY(100%)' }}
      >
        <div className="p-6 space-y-4 h-full flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-4">Add Custom Webhook</h3>
          <div className="flex-1 overflow-y-auto space-y-4 pb-12">
            <div>
              <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Integration Name</label>
              <input type="text" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. My Internal API" className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 outline-none" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Webhook URL</label>
              <input type="url" value={customWebhookUrl} onChange={e => setCustomWebhookUrl(e.target.value)} placeholder="https://api.example.com/webhook" className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 outline-none" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">HTTP Method</label>
              <input type="text" value={customMethod} onChange={e => setCustomMethod(e.target.value)} placeholder="POST" className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 outline-none" />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400 block mb-1">Trigger condition</label>
              <select value={customTrigger} onChange={e => setCustomTrigger(e.target.value)} className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 outline-none bg-white">
                <option>When user asks about prices</option>
                <option>When user wants to book</option>
                <option>When user asks to send message</option>
                <option>Always include in context</option>
              </select>
            </div>
          </div>
          <div className="pt-4 border-t border-slate-100 flex gap-2">
            <button onClick={() => setShowCustomModal(false)} className="flex-1 py-2.5 text-sm font-semibold bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200">Cancel</button>
            <button onClick={handleSaveCustom} className="flex-1 py-2.5 text-sm font-semibold bg-emerald-500 text-white rounded-xl hover:bg-emerald-600">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
