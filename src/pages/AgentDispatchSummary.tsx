import React from 'react';
import { isCurrentStaffOrManager } from '../lib/staffAuth';
import { StaffDayEndSummary } from './StaffDayEndSummary';
import { OldAgentDayEnd } from './OldAgentDayEnd';

/**
 * Day End Dispatch & Bills Page Router
 * 
 * - Staff & Managers: Access the Centralized Database Daily Cash Memos
 *   workbench with the 17 delivery boys roster, switch boy, and scam detection.
 * 
 * - Non-Staff Delivery Boys: Strictly access their personal Old Day End page
 *   where they scan bills and save directly to database, without access to other
 *   delivery boys or the team roster.
 */
export const AgentDispatchSummary: React.FC = () => {
  const isStaff = isCurrentStaffOrManager();

  if (isStaff) {
    return <StaffDayEndSummary />;
  }

  return <OldAgentDayEnd />;
};

export default AgentDispatchSummary;
