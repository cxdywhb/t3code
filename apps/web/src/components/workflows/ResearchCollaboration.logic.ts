export function collaborationStage(name: string) {
  return (
    /^(prd-|analysis-|requirements-review-|design-review-|design-|qa-|archive$)/.exec(name)?.[0] ??
    null
  );
}
