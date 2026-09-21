import { SkeletonTablePage } from "@/components/ui/primitives";

/** studio is a full-width table, with no stat tiles above it. */
export default function Loading() {
  return <SkeletonTablePage cols={5} />;
}
