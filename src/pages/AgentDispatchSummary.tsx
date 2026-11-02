import React, { useState, useEffect } from 'react';
import { isCurrentStaffOrManager, refreshCurrentStaffPermission } from '../lib/staffAuth';
import { StaffDayEndSummary } from './StaffDayEndSummary';
import { OldAgentDayEnd } from './OldAgentDayEnd';
import { Loader2 } from 'lucide-react';

/**
 * Day End Dispatch & Bills Page Router
 * 
 * - Staff & Managers: Access the Centralized Database Daily Cash Memos
 *   workbench with the 17 delivery boys roster, switch boy, and scam detection.
 * 
 * - Non-Staff Delivery Boys (Agents): Strictly access their Old Day End page
 *   locked to their Manager-assigned delivery boy only, without access to other
 *   delivery boys or the team roster.
 */
export const AgentDispatchSummary: React.FC = () => {
  const [isStaff, setIsStaff] = useState<boolean>(() => isCurrentStaffOrManager());
  const [isVerifying, setIsVerifying] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    refreshCurrentStaffPermission()
      .then((liveStaff) => {
        if (isMounted) {
          setIsStaff(liveStaff);
          setIsVerifying(false);
        }
      })
      .catch(() => {
        if (isMounted) setIsVerifying(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-4">
        <Loader2 className="w-8 h-8 animate-spin text-amber-400 mb-2" />
        <span className="text-xs text-slate-400 font-medium tracking-wide">
          Verifying route permissions...
        </span>
      </div>
    );
  }

  if (isStaff) {
    return <StaffDayEndSummary />;
  }

  return <OldAgentDayEnd />;
};

export default AgentDispatchSummary;
