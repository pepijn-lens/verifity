export function formatUsd(value = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 3,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatNumber(value = 0) {
  return new Intl.NumberFormat("en-US").format(value);
}
