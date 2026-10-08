#!/usr/bin/env python3
"""Run only the newly built test process, with an outer timeout and JSON report."""
import argparse
import json
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('executable', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--gui', action='store_true')
    args = parser.parse_args()
    command = [str(args.executable.resolve()), '--smoke-test', '--smoke-report', str(args.report.resolve())]
    if args.gui:
        command.append('--smoke-gui')
    result = subprocess.run(command, timeout=90, check=False)
    if not args.report.is_file():
        raise SystemExit(f'Smoke test produced no report (exit {result.returncode})')
    report = json.loads(args.report.read_text(encoding='utf-8'))
    print(json.dumps(report, indent=2))
    if result.returncode or not report.get('ok'):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
