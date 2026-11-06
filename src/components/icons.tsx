// Bộ icon chung của app: Hugeicons free (stroke-rounded, MIT).
// Mọi component import icon từ đây, không import thẳng thư viện icon,
// để đổi bộ icon hay độ dày nét chỉ phải sửa một chỗ.
import * as React from "react"
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react"
import {
  Tick02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
  Alert02Icon,
  AlertCircleIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons"

export type IconProps = Omit<HugeiconsIconProps, "icon">

/** Độ dày nét mặc định (hướng icon G0 v1.3). */
export const ICON_STROKE = 1.75

export function makeIcon(icon: HugeiconsIconProps["icon"], name: string) {
  const C = (props: IconProps) => (
    <HugeiconsIcon icon={icon} strokeWidth={ICON_STROKE} aria-hidden="true" {...props} />
  )
  C.displayName = name
  return C
}

export const CheckIcon = makeIcon(Tick02Icon, "CheckIcon")
export const ChevronDownIcon = makeIcon(ArrowDown01Icon, "ChevronDownIcon")
export const ChevronUpIcon = makeIcon(ArrowUp01Icon, "ChevronUpIcon")
export const ChevronRightIcon = makeIcon(ArrowRight01Icon, "ChevronRightIcon")
export const XIcon = makeIcon(Cancel01Icon, "XIcon")
export const CircleCheckIcon = makeIcon(CheckmarkCircle02Icon, "CircleCheckIcon")
export const InfoIcon = makeIcon(InformationCircleIcon, "InfoIcon")
export const TriangleAlertIcon = makeIcon(Alert02Icon, "TriangleAlertIcon")
export const OctagonXIcon = makeIcon(AlertCircleIcon, "OctagonXIcon")
export const Loader2Icon = makeIcon(Loading03Icon, "Loader2Icon")

/** Chấm tròn đặc (radio, mục được chọn). Đây là chỉ báo trạng thái, không phải icon. */
export function CircleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-hidden="true">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  )
}

export { HugeiconsIcon }
