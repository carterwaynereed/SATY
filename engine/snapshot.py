"""One-shot: current levels, ribbon, phase, squeeze, active setup + today's signals with probabilities.
    /workspace/v/bin/python /workspace/saty_signals/snapshot.py"""
import core
if __name__ == "__main__":
    print(core.render(core.state(), title="Saty snapshot"))
