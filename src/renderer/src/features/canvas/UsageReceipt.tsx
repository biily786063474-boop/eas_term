import { useCallback, useState } from 'react'
import { useT } from '../../i18n.ts'
import { ReceiptDialog } from './ReceiptDialog'
import { receiptContent, reportRange, type ReportPeriod } from './receiptReport'
export function UsageReceipt({period,onClose}:{period:ReportPeriod;onClose:()=>void}):JSX.Element {
 const tr=useT()
 const [range]=useState(()=>reportRange(period))
 const load=useCallback(async()=>{const data=await window.api.usage.query(range);if(data.error)throw new Error(data.error);return receiptContent(period,range,data)},[period,range])
 return <ReceiptDialog title={tr(period==='week'?'panels.receipt.weeklyTitle':'panels.receipt.monthlyTitle')} load={load} onClose={onClose}/>
}
