import { useCallback, useState } from 'react'
import { ReceiptDialog } from './ReceiptDialog'
import { receiptContent, reportRange, type ReportPeriod } from './receiptReport'
export function UsageReceipt({period,onClose}:{period:ReportPeriod;onClose:()=>void}):JSX.Element {
 const [range]=useState(()=>reportRange(period))
 const load=useCallback(async()=>{const data=await window.api.usage.query(range);if(data.error)throw new Error(data.error);return receiptContent(period,range,data)},[period,range])
 return <ReceiptDialog title={(period==='week'?'周报':'月报')+' · 用量小票'} load={load} onClose={onClose}/>
}
