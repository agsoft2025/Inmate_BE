const normalizeIndianMobile = (value) => {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, "");
  const stripped = digits.replace(/^91/, "").replace(/^0+/, "");
  return stripped;
};

const isValidIndianMobile = (value) => {
  const normalized = normalizeIndianMobile(value);
  return !!normalized && /^[6-9]\d{9}$/.test(normalized);
};

module.exports = {
  normalizeIndianMobile,
  isValidIndianMobile,
};
