import {
  validateProtectedResourceAccess,
  validateProtectedResourceMetadata,
  validateProtectedResourcePair,
  type ProtectedResourceAccess,
  type ProtectedResourceMetadata,
  type ProtectedResourceScope,
} from "../../../functions/src/protectedResources/format.ts";

export function mapProtectedResourceMetadataDocument(
  documentId: string,
  data: unknown,
  scope: ProtectedResourceScope,
): ProtectedResourceMetadata {
  const metadata = validateProtectedResourceMetadata(data, scope);
  if (documentId !== metadata.resourceId) {
    throw new Error("Protected resource is invalid.");
  }
  return metadata;
}

export function sortProtectedResourceMetadata(
  resources: ProtectedResourceMetadata[],
): ProtectedResourceMetadata[] {
  return resources.sort((left, right) => {
    if (left.title !== right.title) return left.title < right.title ? -1 : 1;
    return left.resourceId < right.resourceId
      ? -1
      : left.resourceId > right.resourceId
        ? 1
        : 0;
  });
}

export function mapProtectedResourceAccessDocument(
  documentId: string,
  data: unknown,
  metadata: ProtectedResourceMetadata,
): ProtectedResourceAccess {
  if (documentId !== "primary") {
    throw new Error("Protected resource is invalid.");
  }
  const access = validateProtectedResourceAccess(data);
  validateProtectedResourcePair(metadata, access);
  return access;
}
