exports.getQualitychecks = TryCatch(async (req, res) => {
  const qualityChecks = await QualityCheck.find();
  res.status(200).json({
    status: 200,
    success: true,
    qualityChecks,
  });
});