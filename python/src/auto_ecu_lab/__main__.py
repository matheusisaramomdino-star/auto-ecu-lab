import argparse
from .web import create_app


def main():
    parser = argparse.ArgumentParser(description="AUTO ECU LAB — laboratório local de diagnóstico")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    create_app().run(host="127.0.0.1", port=args.port, debug=False)


if __name__ == "__main__":
    main()
