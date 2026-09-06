export function groupServiceIssuesByAsset(items = []) {
  const groups = [];
  const groupByKey = new Map();

  for (const item of Array.isArray(items) ? items : []) {
    const asset = String(item?.asset || "").trim();
    const assetKey = asset.toLocaleLowerCase();
    const key = assetKey
      ? `asset:${assetKey}`
      : `item:${String(item?.id || groups.length)}`;

    let group = groupByKey.get(key);
    if (!group) {
      group = {
        key,
        asset: asset || "Unknown asset",
        items: [],
      };
      groupByKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}
