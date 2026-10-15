export const notFound = (req, res) => {
  res.status(404).json({ message: "Route not found" });
};

export const errorHandler = (err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Request body is not valid JSON" });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large" });
  }

  if (err.name === "CastError") {
    return res.status(404).json({ message: "Not found" });
  }

  if (err.code === 11000) {
    return res.status(409).json({ message: "That already exists" });
  }

  console.error(err);
  res.status(500).json({ message: "Server error" });
};
