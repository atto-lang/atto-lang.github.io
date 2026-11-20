// Public marketing design sketches. These are not compiler-conformance fixtures.
// Keep the homepage and examples page on one reviewed source of truth.
export const languageMotionExamples = Object.freeze({
  pipelineCode: `
define actor Source as
end

define actor Transform as
end

define actor Sink as
end

pub fnc connect(): ActorStream<int> {
  return spawn Source() pipe spawn Transform() pipe spawn Sink();
}
`,

  mlCode: `
// Proposed ML actor pipeline API, not a shipping compiler feature.
define model Classifier as
  Dense(784, 512)
  ReLU()
  Dense(512, 10)
end

const stages = ml.pipeline(
  Classifier(),
  stages: 3,
  devices: #auto,
  schedule: #one_forward_one_backward
);

const trainer = ml.trainer(
  stages,
  loss: CrossEntropy(),
  optimizer: AdamW(lr: 0.001),
  microbatches: 16
);

// Forward: activations move Source -> Dense -> ReLU -> Dense -> loss.
// Backward: loss gradients travel back through Dense -> ReLU -> Dense.
// Pipeline actors propagate gradients upstream via self.backward(...).
// Each stage accumulates gradients before its AdamW update.
// Actor identity, tensor ownership and device transfers remain bounded.
await trainer.train(dataset);
`,

  httpCode: `
// Proposed Fetch-style response; not yet compiler-verified.
define unary http actor HelloHttp as
  run(HttpMessage request): HttpResponse {
    return new HttpResponse("hello from AttoLang", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
end

// VM-owned HTTP binding sends exactly one returned response.
// Headers are frozen at return; no socket writer escapes.
`,

  httpStreamingCode: `
// Proposed streaming and HTTP trailers; not yet compiler-verified.
define unary http actor Download as
  run(HttpMessage request): HttpResponse {
    const (body, digestReady) = checksumDownload();

    return new HttpResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream"
      },
      trailerNames: ["Content-Digest"],
      trailers: digestReady
    });
  }
end

// body is a readable byte stream; digestReady is Future<HttpHeaders>.
// The VM applies backpressure and completes trailers after body EOF.
`,

  selectCode: `
// Inside an actor's mailbox handler: wait for one selected operation.
do select {
  when readch messages: val msg {
    stdio.println("got: ", msg);
  }

  when readch shutdown: val signal {
    cleanup();
  }

  when writech acknowledgements, receipt: {
    stdio.println("ack sent");
  }
}
`
});
