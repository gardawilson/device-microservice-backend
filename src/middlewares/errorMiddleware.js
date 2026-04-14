export const errorHandler = (err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
};

export const notFound = (req, res, next) => {
  res.status(404).json({ error: "Route not found" });
};
