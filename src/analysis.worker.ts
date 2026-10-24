import { extract, analyze } from './analysis';
self.onmessage = (event: MessageEvent) => {
  try {
    const { target, reference, sensitivity, hints } = event.data;
    const tell = (progress: number, stage: string) => self.postMessage({ progress, stage });
    tell(0.02, 'Listening for musical changes');
    const features = extract(target.samples, target.rate, n => tell(0.05 + n * (reference ? 0.35 : 0.75), 'Listening for musical changes'));
    const ref = reference ? extract(reference.samples, reference.rate, n => tell(0.4 + n * 0.35, 'Analyzing the reference recording')) : undefined;
    tell(0.82, reference ? 'Matching reference timings' : 'Finding repeated passages');
    self.postMessage({ result: analyze(features, sensitivity, ref, hints) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Analysis failed. You can still add sections manually.' }); }
};
